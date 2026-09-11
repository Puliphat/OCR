// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node transposed-label-recovery.test.ts
import { EvaluatedItem } from "./coa-evaluator";
import { realignTransposedLabels } from "./transposed-label-recovery";

// OCR จริงของ TAIHEIYO CMF — บรรทัดชื่อกับบรรทัดค่ามีป้ายนำหน้าคนละตัว
const TAIHEIYO_OCR = [
  "TAIHEIYO CMF TEST REPORT",
  "CMFNO.150",
  "Chemical  |  SiO2  |  A12O3  |  Fe2O3  |  CaO  |  Mg O  |  S  |  pH",
  "Element",
  "(wt%)  |  41.7  |  13.2  |  0.6  |  36.9  |  5.6  |  0.2  |  9.8",
  "Fiber Diameter  (μ m)  |  5.2  |  5 ±0.5",
].join("\n");

function row(name: string, result: number | null, min: number | null = null, max: number | null = null): EvaluatedItem {
  return {
    name,
    unit: null,
    method: null,
    min,
    max,
    result,
    status: min == null && max == null ? "SKIP" : "PASS",
    reason: "",
    specRaw: result == null ? null : String(result),
    resultRaw: result == null ? null : String(result),
    needsReview: false,
  };
}

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: ชื่อเลื่อนไป 1 ช่อง → จับคู่ใหม่ตามตำแหน่งช่อง
{
  const rows = [
    row("Chemical", 41.7),
    row("SiO2", 13.2),
    row("A12O3", 0.6),
    row("Fe2O3", 0.6),
    row("CaO", 36.9),
    row("Mg O", 5.6),
    row("S", 0.2),
    row("pH", 9.8),
  ];
  const res = realignTransposedLabels(rows, TAIHEIYO_OCR);
  // 3 แถวแรกเลื่อน ที่เหลือ (Fe2O3 ลงไป) ค่าตรงช่องอยู่แล้ว → ไม่ต้องแตะ
  check("แก้เฉพาะแถวที่เลื่อนจริง", res.realigned.length, 3);
  check("SiO2 → 41.7", rows[1].result, 41.7);
  check("A12O3 → 13.2", rows[2].result, 13.2);
  check("Fe2O3 → 0.6", rows[3].result, 0.6);
  check("CaO → 36.9", rows[4].result, 36.9);
  check("pH → 9.8", rows[7].result, 9.8);
  check("แถวป้าย (Chemical) ไม่มีค่า", rows[0].result, null);
  check("ปักธงให้คนตรวจ", rows[1].needsReview, true);
  check("ทั้งบล็อกเป็นค่าอ่านอย่างเดียว", rows.every((r) => r.infoOnly === true), true);
}

// 2. ตารางเดียวกันแต่ LLM จับคู่ถูกอยู่แล้ว → ห้ามแตะ
{
  const rows = [
    row("SiO2", 41.7),
    row("A12O3", 13.2),
    row("Fe2O3", 0.6),
    row("CaO", 36.9),
    row("Mg O", 5.6),
    row("S", 0.2),
    row("pH", 9.8),
  ];
  const res = realignTransposedLabels(rows, TAIHEIYO_OCR);
  check("ไม่มีอะไรถูกแก้", res.realigned.length, 0);
  check("SiO2 คงเดิม", rows[0].result, 41.7);
  // ★ จับคู่ถูกอยู่แล้วก็ยังต้องรู้ว่าเป็นบล็อกไม่มีเกณฑ์ ★ ไม่งั้นใบเดียวกันรันคนละรอบขึ้นจอคนละแบบ
  check("ยังรู้ว่าเป็นค่าอ่านอย่างเดียว", rows.every((r) => r.infoOnly === true), true);
}

// 3. แถวที่มีเกณฑ์ (min/max) ห้ามถูกแตะ แม้จะเลื่อน
{
  const rows = [
    row("Chemical", 41.7),
    row("SiO2", 13.2, 40, 45),
    row("A12O3", 0.6),
    row("Fe2O3", 0.6),
    row("CaO", 36.9),
    row("Mg O", 5.6),
    row("S", 0.2),
    row("pH", 9.8),
  ];
  realignTransposedLabels(rows, TAIHEIYO_OCR);
  check("แถวมีเกณฑ์คงค่าเดิม", rows[1].result, 13.2);
  check("แถวไม่มีเกณฑ์ยังแก้ได้", rows[2].result, 13.2);
  check("แถวมีเกณฑ์ไม่ถูกย้ายไปแถบอ่านอย่างเดียว", rows[1].infoOnly, undefined);
}

// 4. เลื่อนทั้งชุด (LLM ทิ้งแถวท้าย) → ต้องจับคู่ใหม่ทุกแถว
{
  const rows = [
    row("Chemical", 41.7),
    row("SiO2", 13.2),
    row("A12O3", 0.6),
    row("Fe2O3", 36.9),
    row("CaO", 5.6),
    row("Mg O", 0.2),
    row("S", 9.8),
  ];
  const res = realignTransposedLabels(rows, TAIHEIYO_OCR);
  check("เลื่อนทั้งชุด → แก้ทุกแถว", res.realigned.length, 7);
  check("SiO2 → 41.7", rows[1].result, 41.7);
  check("Fe2O3 → 0.6", rows[3].result, 0.6);
  check("S → 0.2", rows[6].result, 0.2);
}

// 5. เคสจริงจาก pipeline: LLM copy ค่าผลมาเป็นเกณฑ์ (min=max) → ยังถือว่าไม่มีเกณฑ์ ต้องแก้ได้
{
  const rows = [
    row("Chemical", 41.7, 41.7, 41.7),
    row("SiO2", 13.2, 13.2, 13.2),
    row("A12O3", 0.6, 0.6, 0.6),
    row("Fe2O3", 36.9, 36.9, 36.9),
    row("CaO", 5.6, 5.6, 5.6),
    row("Mg O", 0.2, 0.2, 0.2),
    row("S", 9.8, 9.8, 9.8),
  ];
  rows.forEach((r) => (r.status = "SKIP"));
  const res = realignTransposedLabels(rows, TAIHEIYO_OCR);
  check("เกณฑ์ที่ copy มาไม่บล็อกการแก้", res.realigned.length, 7);
  check("SiO2 → 41.7", rows[1].result, 41.7);
  check("ล้างเกณฑ์ที่ copy มาทิ้ง", [rows[1].min, rows[1].specRaw], [null, null]);
  check("ยังเป็น SKIP เหมือนเดิม", rows[1].status, "SKIP");
}

// 6. ตารางปกติ (ชื่อ|เกณฑ์|ผล ต่อแถว) → ไม่มีคู่ header/value ให้จับ
{
  const ocr = ["Moisture | 2 max | 0.71", "pH | 10.5-11.5 | 11.13", "Density | 0.3-0.45 | 0.34"].join("\n");
  const rows = [row("Moisture", 0.71), row("pH", 11.13), row("Density", 0.34)];
  const res = realignTransposedLabels(rows, ocr);
  check("ตารางปกติไม่ถูกแตะ", res.realigned.length, 0);
  check("ตารางปกติไม่มีแถวอ่านอย่างเดียว", rows.some((r) => r.infoOnly), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
