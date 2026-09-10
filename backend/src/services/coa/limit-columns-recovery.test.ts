// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node limit-columns-recovery.test.ts
import { RawCoaItem } from "./ollama-coa.service";
import { recoverLimitColumns } from "./limit-columns-recovery";

// OCR จริงของ (NYGLOS8) — IMERYS วางเกณฑ์ไว้ก่อนค่าผล
const NYGLOS_OCR = [
  "Certificate of Analysis",
  "Characteristics  |  Methods  |  Lower limit  |  Upper limit  |  Analysis  |  Results  |  Unit",
  "MedianParticleSize  |  10.7  |  14.0  |  12.5  |  μm",
  "TapBulkDen (g/cc)  |  0.42  |  0.56  |  0.50  |  g/cm3",
  "Air Jet Sieve +50M (%)  |  0  |  0  |  0  |  %",
  "Brightness  |  0  |  100  |  88  |  %",
].join("\n");

// ใบปกติ (Zirconium): เกณฑ์อยู่คอลัมน์เดียว ผลอยู่ขวา — ห้ามแตะ
const NORMAL_OCR = [
  "Item  |  Unit  |  Specification  |  Analysis Result",
  "ZrO2+HfO2  |  %  |  64.30~ 66.30  |  65.27",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: LLM หยิบเลขตัวแรก (ขอบล่าง) มาเป็นค่าผล → ต้องสลับกลับให้ถูก
{
  const items: RawCoaItem[] = [
    { name: "MedianParticleSize", result: 10.7, specMin: 12.5, specMax: 14.0 },
    { name: "TapBulkDen (g/cc)", result: 0.42, specMin: 0.5, specMax: 0.56 },
    { name: "Brightness", result: 0, specMin: 88, specMax: 100 },
  ];
  const res = recoverLimitColumns(items, NYGLOS_OCR);
  check("แก้ครบ 3 แถว", res.fixed.length, 3);
  check("Median: ผล 12.5 เกณฑ์ 10.7~14", [items[0].result, items[0].specMin, items[0].specMax], [12.5, 10.7, 14]);
  check("TapBulkDen: ผล 0.50 เกณฑ์ 0.42~0.56", [items[1].result, items[1].specMin, items[1].specMax], [0.5, 0.42, 0.56]);
  check("Brightness: ผล 88 เกณฑ์ 0~100", [items[2].result, items[2].specMin, items[2].specMax], [88, 0, 100]);
}

// 2. แถวที่ขอบบน=ขอบล่าง (Air Jet Sieve 0|0|0) ยังอ่านได้ ไม่ตกขอบ
{
  const items: RawCoaItem[] = [{ name: "Air Jet Sieve +50M (%)", result: 0, specMin: 0, specMax: 0 }];
  const res = recoverLimitColumns(items, NYGLOS_OCR);
  check("0|0|0 อ่านได้", res.fixed.length, 1);
  check("ผล 0 เกณฑ์ 0~0", [items[0].result, items[0].specMin, items[0].specMax], [0, 0, 0]);
}

// 3. ใบที่หัวตารางไม่ได้วางเกณฑ์ไว้ก่อนผล → ห้ามแตะเลย (abstain)
{
  const items: RawCoaItem[] = [{ name: "ZrO2+HfO2", result: 65.27, specMin: 64.3, specMax: 66.3 }];
  const res = recoverLimitColumns(items, NORMAL_OCR);
  check("ใบปกติ → ไม่แตะ", res.fixed.length, 0);
  check("ค่าเดิมอยู่ครบ", items[0].result, 65.27);
}

// 4. ชื่อรายการหาไม่เจอในข้อความ → ข้ามแถวนั้น ไม่เดา
{
  const items: RawCoaItem[] = [{ name: "ไม่มีในใบ", result: 1, specMin: 2, specMax: 3 }];
  const res = recoverLimitColumns(items, NYGLOS_OCR);
  check("ชื่อไม่ตรง → ข้าม", res.fixed.length, 0);
}

// 6. ★ reviewer ROUND 33 ★ มีเลข 4 ช่อง → จับคู่ไม่ได้แน่นอน ห้ามเดา
{
  const ocr = [NYGLOS_OCR, "Mesh  |  50  |  88  |  100  |  92"].join("\n");
  const items: RawCoaItem[] = [{ name: "Mesh", result: 50 }];
  const res = recoverLimitColumns(items, ocr);
  check("4 ช่อง → ไม่แตะ", res.fixed.length, 0);
}

// 7. ★ reviewer ROUND 33 ★ บล็อกที่อยู่เหนือหัวตาราง (คอลัมน์คนละแบบ) ต้องไม่โดนเขียนทับ
{
  const ocr = ["Moisture  |  0.2  |  0.5  |  1.0", NYGLOS_OCR].join("\n");
  const items: RawCoaItem[] = [{ name: "Moisture", result: 1.0, specMin: 0.2, specMax: 0.5 }];
  const res = recoverLimitColumns(items, ocr);
  check("บรรทัดเหนือหัวตาราง → ไม่แตะ", res.fixed.length, 0);
  check("ค่าเดิมอยู่ครบ", items[0].result, 1.0);
}

// 8. ★ reviewer ROUND 33 ★ ค่าเดิมของ LLM ไม่ใช่ขอบล่าง = คนละอาการ ห้ามเขียนทับ
{
  const items: RawCoaItem[] = [{ name: "Brightness", result: 88, specMin: 0, specMax: 100 }];
  const res = recoverLimitColumns(items, NYGLOS_OCR);
  check("ค่าผลถูกอยู่แล้ว → ไม่แตะ", res.fixed.length, 0);
}

// 5. บรรทัดมีเลขไม่ครบ 3 ตัว → ข้าม (ไม่เดาว่าตัวไหนคือเกณฑ์)
{
  const ocr = NYGLOS_OCR.replace("MedianParticleSize  |  10.7  |  14.0  |  12.5  |  μm", "MedianParticleSize  |  12.5  |  μm");
  const items: RawCoaItem[] = [{ name: "MedianParticleSize", result: 12.5 }];
  const res = recoverLimitColumns(items, ocr);
  check("เลขไม่ครบ → ข้าม", res.fixed.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
