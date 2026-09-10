// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node spec-row-below-recovery.test.ts
import { recoverSpecRowBelow } from "./spec-row-below-recovery";

// OCR จริงของ Tin Powder AT-Sn No.200 — แถว Specifications อยู่ใต้แถวค่า และ D10 ไม่มีเกณฑ์
const TIN_OCR = [
  "Total  |  100  |  kg",
  "Lot No.  |  Net weight(kg)  |  Particle size (μ m) for each cumulative %  |  Decision  |  Remarks",
  "D10  |  D50  |  D90  |  D100",
  "SA2607003  |  100  |  8.8  |  23.8  |  58.7  |  209.3  |  Pass",
  "Specifications  |  18-26  |  43-71  |  ≤248.9",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: ยึดขวา → D10 ไม่มีเกณฑ์ ส่วน D50/D90/D100 ได้เกณฑ์ของตัวเอง
{
  const res = recoverSpecRowBelow(TIN_OCR);
  check("ออก 4 แถว", res?.items.length, 4);
  check("ชื่อคอลัมน์ครบ", res?.items.map((i) => i.name), ["D10", "D50", "D90", "D100"]);
  check("D10 ไม่มีเกณฑ์ (ใบไม่ได้กำหนด)", res?.items[0].specRaw, null);
  check("ค่าจับคู่ถูกคอลัมน์", res?.items.map((i) => i.result), [8.8, 23.8, 58.7, 209.3]);
  check("เกณฑ์ยึดขวา", res?.items.slice(1).map((i) => i.specRaw), ["18-26", "43-71", "≤248.9"]);
  check("แถวที่มีเกณฑ์ติดธง specFromCell", res?.items[1].specFromCell, true);
  check("แถวที่ไม่มีเกณฑ์ไม่ติดธง", res?.items[0].specFromCell, undefined);
}

// 2. เกณฑ์ที่จับคู่แล้วขัดกับค่า → ถอยทั้งใบ (ห้ามลองสลับให้เข้าเกณฑ์)
{
  const ocr = TIN_OCR.replace("58.7", "999");
  check("ค่าหลุดเกณฑ์ → abstain", recoverSpecRowBelow(ocr), null);
}

// 3. ใบที่ไม่มีแถว Specifications → ไม่แตะ
{
  const ocr = TIN_OCR.replace("Specifications", "Remarks");
  check("ไม่มีแถวเกณฑ์ → abstain", recoverSpecRowBelow(ocr), null);
}

// 4. เกณฑ์มากกว่าคอลัมน์ = อ่านตำแหน่งผิด → ไม่แตะ
{
  const ocr = TIN_OCR.replace("D10  |  D50  |  D90  |  D100", "D50  |  D90");
  check("เกณฑ์เกินจำนวนป้าย → abstain", recoverSpecRowBelow(ocr), null);
}

// 5. แถวเกณฑ์มีช่องเดียว = ไม่ใช่ตารางแนวนอนท่านี้
{
  const ocr = TIN_OCR.replace("Specifications  |  18-26  |  43-71  |  ≤248.9", "Specifications  |  18-26");
  check("เกณฑ์ช่องเดียว → abstain", recoverSpecRowBelow(ocr), null);
}

// 6b. ★ reviewer ROUND 34 ★ ต้องติดกัน 3 บรรทัด — มีบรรทัดอื่นคั่นระหว่างค่ากับเกณฑ์ = จับคู่เชื่อไม่ได้
{
  const ocr = TIN_OCR.replace(
    "Specifications  |  18-26",
    "Approved by QA  |  2026\nSpecifications  |  18-26"
  );
  check("มีบรรทัดคั่น → abstain", recoverSpecRowBelow(ocr), null);
}

// 6c. แถวป้ายคอลัมน์ต้องอยู่ติดเหนือแถวค่า ไม่ใช่ไล่ขึ้นไปหาเอง
{
  const ocr = TIN_OCR.replace(
    "SA2607003  |  100",
    "Remarks  |  none\nSA2607003  |  100"
  );
  check("ป้ายไม่ติดแถวค่า → abstain", recoverSpecRowBelow(ocr), null);
}

// 6. ช่องเกณฑ์ที่อ่านเป็นตัวเลขไม่ได้ → ไม่เดา
{
  const ocr = TIN_OCR.replace("43-71", "good");
  check("เกณฑ์อ่านไม่ออก → abstain", recoverSpecRowBelow(ocr), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
