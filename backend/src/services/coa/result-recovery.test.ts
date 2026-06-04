import { recoverResultsFromOcr } from "./result-recovery";
import { RawCoaItem } from "./ollama-coa.service";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", label, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

// ── ZP10: LLM ทิ้ง result field, OCR มีค่าครบ (เว้นวรรคในเลข "1. 09") ──
const zp10Ocr = [
  "No.  |  TESTITEMS  |  UNIT  |  SPECIFICATION  |  RESULTS  |  TEST METHOD",
  "Freeness  |  350-650  |  388  |  TAPPI 227",
  "Fiber Length  |  0. 70~1. 30  |  1. 09  |  TAPPI 271",
  "Specific Surface Area  |  6. 00-11. 00  |  9. 31  |  GB/T 19587  |  (b, E. T)",
  "Moisture content  |  4. 0-8. 0  |  6. 2  |  TAPPI 412",
].join("\n");

{
  const items: RawCoaItem[] = [
    { name: "Freeness", specRaw: "350-650", method: "TAPPI 227", result: "388" },
    { name: "Fiber Length", specRaw: "0.70~1.30", method: "TAPPI 271", result: null },
    { name: "Specific Surface Area", specRaw: "6.00-11.00", method: "GB/T 19587", result: null },
    { name: "Moisture content", specRaw: "4.0-8.0", method: "TAPPI 412", result: null },
  ];
  const { recovered } = recoverResultsFromOcr(items, zp10Ocr);
  check("ZP10 recovered count = 3", recovered === 3, recovered);
  check("Freeness untouched (had result)", items[0].result === "388", items[0].result);
  check("Fiber Length → 1.09", items[1].result === "1.09", items[1].result);
  check("Specific Surface Area → 9.31", items[2].result === "9.31", items[2].result);
  check("Moisture content → 6.2", items[3].result === "6.2", items[3].result);
}

// ── ปฏิเสธ: เหลือผู้สมัคร ≥2 ตัว → ไม่เติม (กำกวม → honest SKIP) ──
{
  const items: RawCoaItem[] = [{ name: "Foo Bar", specRaw: "1-2", result: null }];
  const ocr = "Foo Bar  |  1-2  |  5  |  7";
  const { recovered } = recoverResultsFromOcr(items, ocr);
  check("ambiguous (2 cands) not recovered", recovered === 0 && items[0].result == null, items[0].result);
}

// ── ปฏิเสธ: ไม่มี spec → ไม่เติม ──
{
  const items: RawCoaItem[] = [{ name: "Baz Qux", result: null }];
  const ocr = "Baz Qux  |  9";
  const { recovered } = recoverResultsFromOcr(items, ocr);
  check("no-spec not recovered", recovered === 0 && items[0].result == null, items[0].result);
}

// ── ปฏิเสธ: หาบรรทัดของ row ไม่เจอ → ไม่เติม ──
{
  const items: RawCoaItem[] = [{ name: "Totally Absent Name", specRaw: "1-2", result: null }];
  const ocr = "Something Else  |  1-2  |  9";
  const { recovered } = recoverResultsFromOcr(items, ocr);
  check("name-not-found not recovered", recovered === 0 && items[0].result == null, items[0].result);
}

// ── ปฏิเสธ: ผู้สมัครตัวเดียวแต่ตรงกับเลข spec → ถูก exclude → เหลือ 0 → ไม่เติม ──
{
  const items: RawCoaItem[] = [{ name: "Only Spec Num", specRaw: "5 Max.", result: null }];
  const ocr = "Only Spec Num  |  5 Max.";
  const { recovered } = recoverResultsFromOcr(items, ocr);
  check("only-spec-number not recovered", recovered === 0 && items[0].result == null, items[0].result);
}

// ── ยอมรับ: single bound result column ("<15") ก็เป็น cell ตัวเลข? ── ไม่ใช่: "<15" ไม่ผ่าน singleNumberCell
{
  const items: RawCoaItem[] = [{ name: "Cd ppm", specRaw: "< 15", result: null }];
  const ocr = "Cd ppm  |  < 15  |  < 15"; // ทั้ง spec และ result เป็น "<15" — ไม่ใช่ตัวเลขเดี่ยว → ไม่เติม
  const { recovered } = recoverResultsFromOcr(items, ocr);
  check("bound-text cell not recovered (handled by bound-result path)", recovered === 0, items[0].result);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
