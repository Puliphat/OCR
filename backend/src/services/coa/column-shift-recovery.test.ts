import { downgradeColumnShiftedResults } from "./column-shift-recovery";
import { EvaluatedItem } from "./coa-evaluator";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", label, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

function row(p: Partial<EvaluatedItem>): EvaluatedItem {
  return {
    name: "",
    unit: null,
    method: null,
    min: null,
    max: null,
    result: null,
    status: "PASS",
    reason: "",
    specRaw: null,
    resultRaw: null,
    needsReview: false,
    ...p,
  };
}

// RI-015: aperture เป็น result (FAIL ปลอม) → downgrade SKIP
{
  const ocr = ["0.425  |  10.0 - 45.0  |  36.0", "0.150  |  50.0 - 80.0  |  60.0"].join("\n");
  const rows = [
    row({ name: "Particle Size", status: "FAIL", result: 0.425, resultRaw: "0.425", specRaw: "10.0 - 45.0", min: 10, max: 45 }),
    row({ name: "Particle Size", status: "FAIL", result: 0.15, resultRaw: "0.15", specRaw: "50.0 - 80.0", min: 50, max: 80 }),
  ];
  const { downgraded } = downgradeColumnShiftedResults(rows, ocr);
  check("RI-015 downgraded 2", downgraded.length === 2, downgraded);
  check("row0 FAIL→SKIP", rows[0].status === "SKIP" && rows[0].needsReview, rows[0].status);
  check("row1 FAIL→SKIP", rows[1].status === "SKIP", rows[1].status);
  check("suspect = 36", downgraded[0]?.suspectAfterSpec === "36", downgraded[0]);
}

// ★ reviewer's deceptive case ★ — result จริงอยู่ซ้าย spec (FAIL จริง 12.5>10), เพื่อนบ้าน 8.0 หลัง spec
//   overwrite เดิม = PASS ปลอม. ตอนนี้ downgrade → SKIP (ปลอดภัย: column mapping กำกวม)
{
  const ocr = "12.5  |  10 Max.  |  8.0";
  const rows = [row({ name: "Ash", status: "FAIL", result: 12.5, resultRaw: "12.5", specRaw: "10 Max.", max: 10 })];
  const { downgraded } = downgradeColumnShiftedResults(rows, ocr);
  check("deceptive-PASS layout → SKIP not PASS", rows[0].status === "SKIP" && downgraded.length === 1, rows[0].status);
}

// layout ปกติ name|spec|result — cell[0]=ชื่อ ≠ result → ไม่แตะ
{
  const ocr = "Moisture content  |  4. 0-8. 0  |  6. 2  |  TAPPI 412";
  const rows = [row({ name: "Moisture content", status: "PASS", result: 6.2, resultRaw: "6.2", specRaw: "4.0-8.0", min: 4, max: 8 })];
  const { downgraded } = downgradeColumnShiftedResults(rows, ocr);
  check("normal layout untouched", rows[0].status === "PASS" && downgraded.length === 0, rows[0].status);
}

// result==cell[0] แต่ไม่มีเลข unclaimed หลัง spec (0.0 ถูกจองโดย spec 0-1) → ไม่แตะ
{
  const ocr = "0.850  |  0.0 - 1.0  |  0.0";
  const rows = [row({ name: "S", status: "PASS", result: 0.85, resultRaw: "0.85", specRaw: "0.0 - 1.0", min: 0, max: 1 })];
  const { downgraded } = downgradeColumnShiftedResults(rows, ocr);
  check("no unclaimed-after untouched", rows[0].status === "PASS" && downgraded.length === 0, rows[0].status);
}

// SKIP row ไม่แตะ
{
  const ocr = "0.425  |  10.0 - 45.0  |  36.0";
  const rows = [row({ name: "X", status: "SKIP", result: 0.425, resultRaw: "0.425", specRaw: "10.0 - 45.0", min: 10, max: 45 })];
  const { downgraded } = downgradeColumnShiftedResults(rows, ocr);
  check("SKIP untouched", rows[0].status === "SKIP" && downgraded.length === 0, rows[0].status);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
