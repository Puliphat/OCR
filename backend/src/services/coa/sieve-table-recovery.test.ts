import {
  recoverSieveTableResults,
  recoverMissingSieveRows,
  isSieveTable,
  isDescendingApertureSeries,
} from "./sieve-table-recovery";
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
    name: "Particle Size",
    unit: null,
    method: null,
    min: null,
    max: null,
    result: null,
    status: "SKIP",
    reason: "",
    specRaw: null,
    resultRaw: null,
    needsReview: false,
    ...p,
  };
}

// OCR ที่มี header ตาราง sieve (gate 1 ผ่าน) + บรรทัดข้อมูล 4 แถว
const SIEVE_OCR = [
  "PARTICLE SIZE (100 g / 15 min)",
  "SIEVE  |  PATTERN  |  Lot #",
  "0.850  |  0.0 - 1.0  |  0.0",
  "0.425  |  10.0 - 45.0  |  36.0",
  "0.150  |  50.0 - 80.0  |  60.0",
  "<0.150  |  0.0 - 12.0  |  4.0",
].join("\n");

// ชุด 4 sieve rows ของ RI-015 (aperture-as-result, SKIP)
function ri015Rows(): EvaluatedItem[] {
  return [
    row({ status: "SKIP", result: 0.85, resultRaw: "0.850", specRaw: "0.0 - 1.0", min: 0, max: 1 }),
    row({ status: "SKIP", result: 0.425, resultRaw: "0.425", specRaw: "10.0 - 45.0", min: 10, max: 45 }),
    row({ status: "SKIP", result: 0.15, resultRaw: "0.150", specRaw: "50.0 - 80.0", min: 50, max: 80 }),
    row({ status: "SKIP", result: null, resultRaw: "<0.150", specRaw: "0.0 - 12.0", min: 0, max: 12 }),
  ];
}

// ---- gate helpers ----
{
  check("isSieveTable: particle size", isSieveTable("foo PARTICLE SIZE bar"));
  check("isSieveTable: sieve+pattern", isSieveTable("SIEVE | PATTERN | x"));
  check("isSieveTable: sieve alone = false", !isSieveTable("Residue on sieve(1mm)"));
  check("isSieveTable: none = false", !isSieveTable("Moisture | 4-8 | 6"));

  check("series: 3 descending", isDescendingApertureSeries([0.85, 0.425, 0.15]));
  check("series: 4 non-incr (eq tail) ok", isDescendingApertureSeries([0.85, 0.425, 0.15, 0.15]));
  check("series: 2 = false (<3)", !isDescendingApertureSeries([0.85, 0.425]));
  check("series: 1 = false", !isDescendingApertureSeries([12.5]));
  check("series: increasing = false", !isDescendingApertureSeries([0.1, 0.2, 0.3]));
  check("series: 3 same = false (distinct<3)", !isDescendingApertureSeries([5, 5, 5]));
}

// ★ RI-015: 4 aperture-as-result SKIP rows → promote PASS (gate 4 ผ่าน: series ลดหลั่น) ★
{
  const rows = ri015Rows();
  const { recovered } = recoverSieveTableResults(rows, SIEVE_OCR);
  check("RI-015 recovered 4", recovered.length === 4, recovered);
  check("0.850 → PASS 0", rows[0].status === "PASS" && rows[0].result === 0, rows[0]);
  check("0.425 → PASS 36", rows[1].status === "PASS" && rows[1].result === 36, rows[1]);
  check("0.150 → PASS 60", rows[2].status === "PASS" && rows[2].result === 60, rows[2]);
  check("<0.150 → PASS 4", rows[3].status === "PASS" && rows[3].result === 4, rows[3]);
  check("all needsReview", rows.every((r) => r.needsReview));
  // ★ resultRaw sync (reviewer SHOULD-FIX) — ไม่ค้าง aperture เดิม
  check("resultRaw synced 0.425→36", rows[1].resultRaw === "36", rows[1].resultRaw);
}

// ★ gate (4) — reviewer's deceptive single-row repro ★ — Residue on sieve(106μm), result จริง 12.5 (OOS,
//   ซ้าย spec) + 8.0 เพื่อนบ้าน in-range. ก่อนหน้านี้ overwrite 12.5→8.0 = PASS ปลอม. ตอนนี้มี candidate
//   เดียว → series < 3 → ไม่ promote (กัน deceptive PASS ซ่อนของเสีย)
{
  const ocr = "PARTICLE SIZE sieve analysis\n12.5  |  10 Max.  |  8.0";
  const rows = [row({ name: "Residue on sieve(106um)", status: "SKIP", result: 12.5, resultRaw: "12.5", specRaw: "10 Max.", max: 10 })];
  const { recovered } = recoverSieveTableResults(rows, ocr);
  check("single-row deceptive → NOT promoted", rows[0].status === "SKIP" && recovered.length === 0, rows[0].status);
}

// ★ gate (4) — 2 candidates ยังไม่พอ (ต้อง ≥3) ★
{
  const rows = ri015Rows().slice(0, 2); // 0.850, 0.425
  const { recovered } = recoverSieveTableResults(rows, SIEVE_OCR);
  check("2 candidates → NOT promoted", recovered.length === 0 && rows.every((r) => r.status === "SKIP"), recovered);
}

// ★ gate (2) — chem row ชื่อไม่ใช่ sieve ในไฟล์ที่มี sieve table (3 แถวจริง) ★
//   3 sieve promote, Ash row (cell[0]=numeric, in-range neighbor) ไม่ถูกแตะเพราะชื่อ "Ash"
{
  const ocr = SIEVE_OCR + "\n12.5  |  10 Max.  |  8.0";
  const sieve = ri015Rows().slice(0, 3); // 3 sieve candidates → gate4 ผ่าน
  const ash = row({ name: "Ash", status: "SKIP", result: 12.5, resultRaw: "12.5", specRaw: "10 Max.", max: 10 });
  const rows = [...sieve, ash];
  const { recovered } = recoverSieveTableResults(rows, ocr);
  check("3 sieve promoted, Ash untouched", recovered.length === 3 && ash.status === "SKIP", { recovered: recovered.length, ash: ash.status });
}

// ★ gate (1) ★ ไม่มี sieve header → ไม่แตะ (แม้ครบ 4 แถว)
{
  const ocr = ["0.850  |  0.0 - 1.0  |  0.0", "0.425  |  10.0 - 45.0  |  36.0", "0.150  |  50.0 - 80.0  |  60.0", "<0.150  |  0.0 - 12.0  |  4.0"].join("\n");
  const rows = ri015Rows();
  const { recovered } = recoverSieveTableResults(rows, ocr);
  check("no header → untouched", recovered.length === 0 && rows.every((r) => r.status === "SKIP"), recovered);
}

// ★ promote เฉพาะ PASS ★ — 3 candidates ผ่าน gate4; แต่แถวที่ result จริง OOS → re-eval FAIL → ปล่อย SKIP
{
  const ocr = [
    "PARTICLE SIZE",
    "SIEVE | PATTERN",
    "0.850  |  0.0 - 1.0  |  0.0",
    "0.425  |  10.0 - 45.0  |  50.0", // result จริง 50 > 45 = OOS
    "0.150  |  50.0 - 80.0  |  60.0",
  ].join("\n");
  const rows = [
    row({ status: "SKIP", result: 0.85, resultRaw: "0.850", specRaw: "0.0 - 1.0", min: 0, max: 1 }),
    row({ status: "SKIP", result: 0.425, resultRaw: "0.425", specRaw: "10.0 - 45.0", min: 10, max: 45 }),
    row({ status: "SKIP", result: 0.15, resultRaw: "0.150", specRaw: "50.0 - 80.0", min: 50, max: 80 }),
  ];
  const { recovered } = recoverSieveTableResults(rows, ocr);
  check("OOS result stays SKIP, others PASS", rows[1].status === "SKIP" && rows[0].status === "PASS" && rows[2].status === "PASS" && recovered.length === 2, { r0: rows[0].status, r1: rows[1].status, r2: rows[2].status });
}

// non-SKIP row ไม่นับเป็น candidate (ทำงานบน SKIP เท่านั้น)
//   ตัด row 0.150 ออก → candidate apertures = {0.85, 0.425, 0.15(<0.150)} = 3 distinct → ยังผ่าน gate4
{
  const rows = ri015Rows();
  rows[2].status = "PASS"; // 0.150 row → ออกจาก candidate, เหลือ 0.850/0.425/<0.150
  const { recovered } = recoverSieveTableResults(rows, SIEVE_OCR);
  check("non-SKIP excluded (3 left promote)", recovered.length === 3 && rows[2].status === "PASS", { recovered: recovered.length, r2: rows[2].status });
}

// ★ recoverMissingSieveRows — แถว 2.000 ที่ LLM ทิ้ง (เคสจริง RI-015) ★
const MISSING_OCR = [
  "PARTICLE SIZE (100 g / 15 min)",
  "SIEVE  |  PATTERN  |  Lot #",
  "2.000  |  0.0  |  0.0",
  "0.850  |  0.0 - 1.0  |  0.0",
  "0.425  |  10.0 - 45.0  |  36.0",
  "0.150  |  50.0 - 80.0  |  60.0",
].join("\n");

// existing items = 3 แถว (LLM ทิ้ง 2.000) → ต้องเติม 2.000 เป็น PASS
{
  const rows = [
    row({ status: "SKIP", result: 0, resultRaw: "0.0", specRaw: "0.0 - 1.0", min: 0, max: 1 }),
    row({ status: "PASS", result: 36, resultRaw: "36.0", specRaw: "10.0 - 45.0", min: 10, max: 45 }),
    row({ status: "PASS", result: 60, resultRaw: "60.0", specRaw: "50.0 - 80.0", min: 50, max: 80 }),
  ];
  const { added } = recoverMissingSieveRows(rows, MISSING_OCR);
  const new2 = rows.find((r) => r.specRaw === "0.0" && r.result === 0);
  check("missing 2.000 row added as SKIP+amber (shows, not promoted)", added.length === 1 && !!new2 && new2!.status === "SKIP" && new2!.needsReview === true, { added: added.length, st: new2?.status });
  check("2.000 inserted at top of sieve group", rows[0] === new2, { firstSpec: rows[0]?.specRaw });
}

// แถวที่มีอยู่แล้ว (specKey+result ตรง) → ไม่ add ซ้ำ
{
  const rows = [
    row({ status: "PASS", result: 0, resultRaw: "0.0", specRaw: "0.0", min: 0, max: 0 }),
    row({ status: "SKIP", result: 0, resultRaw: "0.0", specRaw: "0.0 - 1.0", min: 0, max: 1 }),
    row({ status: "PASS", result: 36, resultRaw: "36.0", specRaw: "10.0 - 45.0", min: 10, max: 45 }),
    row({ status: "PASS", result: 60, resultRaw: "60.0", specRaw: "50.0 - 80.0", min: 50, max: 80 }),
  ];
  const { added } = recoverMissingSieveRows(rows, MISSING_OCR);
  check("already-present 2.000 → no duplicate add", added.length === 0, { added: added.length });
}

// ไม่ใช่ sieve table (gate 1) → ไม่ add
{
  const rows = [row({ status: "PASS", result: 36, specRaw: "10.0 - 45.0", min: 10, max: 45 })];
  const { added } = recoverMissingSieveRows(rows, "Assay 99.2 Min | 99.56\nMoisture 0.5 | 0.28");
  check("non-sieve doc → no add", added.length === 0, { added: added.length });
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
