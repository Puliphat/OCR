// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node paren-spec-recovery.test.ts
import { recoverParenSpecRows } from "./paren-spec-recovery";

// OCR จริงของ Copper Fiber CCW-210(A) — ค่าวัด 3 ครั้ง + Average + เกณฑ์ในวงเล็บ
const CCW_OCR = [
  "TESTREPORT",
  "(1)  |  (2)  |  (3)  |  Average(  |  (Specification)",
  "1. Apparent Density (g/cm3):  |  0.64  |  0.62  |  0.63  |  0.63  |  (0.48~0.88)",
  "2.Particle Size (%):  |  1400μm on  |  0  |  0  |  0  |  0  |  (0)",
  "(M) :Ref.mesh size  |  355μmon  |  17. 1  |  17.1  |  15.3  |  16.5  |  (2～22)",
  "150μmon  |  41.9  |  40.6  |  41.7  |  41. 4  |  (29~59)",
  "75μm thru  |  0.3  |  0.8  |  0.8  |  0.6  |  (0～1)",
  "5. Weight (Kg/1 Bag):  |  10.00  |  10.00  |  10.00  |  10.00  |  (10±0.05)",
  "6. Appearance :  |  good",
].join("\n");

// ใบปกติ (Zirconium) — เกณฑ์ไม่ได้อยู่ในวงเล็บ ห้ามแตะ
const NORMAL = [
  "Item  |  Unit  |  Specification  |  Analysis Result",
  "ZrO2+HfO2  |  %  |  64.30~ 66.30  |  65.27",
  "SiO2  |  %  |  31.40~33.40  |  32.44",
  "S-Fe2O3  |  %  |  0.020  |  Max  |  0.007",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: ต้องได้ค่าจากช่อง Average ไม่ใช่ค่าวัดครั้งสุดท้าย
{
  const res = recoverParenSpecRows(CCW_OCR);
  check("อ่านได้", res != null, true);
  check("ได้ 6 แถว (แถว Appearance ไม่มีเลข → ไม่นับ)", res?.rows, 6);
  const byName = Object.fromEntries(res!.items.map((i) => [i.name, i]));
  check("Apparent Density = 0.63 (Average) เกณฑ์ 0.48~0.88",
    [byName["Apparent Density (g/cm3)"]?.result, byName["Apparent Density (g/cm3)"]?.specRaw], [0.63, "0.48~0.88"]);
  check("355μm on = 16.5 ไม่ใช่ 15.3 (ค่าวัดครั้งที่ 3)",
    byName["(M) :Ref.mesh size 355μmon"]?.result, 16.5);
  check("OCR เว้นวรรคหลังจุด: 41. 4 → 41.4", byName["150μmon"]?.result, 41.4);
  check("เกณฑ์เลขเดี่ยวในวงเล็บ (0) อ่านได้", byName["Particle Size (%): 1400μm on"]?.specRaw, "0");
  check("เกณฑ์ ± ในวงเล็บ", byName["Weight (Kg/1 Bag)"]?.specRaw, "10±0.05");
}

// 2. ใบที่เกณฑ์ไม่ได้อยู่ในวงเล็บ → abstain
{
  check("ใบปกติ → ไม่แตะ", recoverParenSpecRows(NORMAL), null);
}

// 3. มีวงเล็บท้ายแต่ไม่มีค่าวัดหลายครั้ง → ไม่ใช่ layout นี้
{
  const ocr = [
    "Moisture  |  0.71  |  (2 max)",
    "pH  |  11.1  |  (10.5~11.5)",
    "Density  |  0.34  |  (0.3~0.45)",
  ].join("\n");
  check("ค่าเดียวต่อแถว → abstain", recoverParenSpecRows(ocr), null);
}

// 5. ★ reviewer ROUND 33 ★ ไม่มีคอลัมน์ Average ในใบ → ช่องก่อนวงเล็บคือค่าวัดครั้งสุดท้าย ห้ามใช้ตัดสิน
{
  const ocr = [
    "Thickness  |  17.1  |  17.1  |  16.9  |  (2~22)",
    "Length  |  41.9  |  40.6  |  41.7  |  (29~59)",
    "Weight  |  0.3  |  0.8  |  0.8  |  (0~1)",
  ].join("\n");
  check("ไม่มีคำว่า Average → abstain", recoverParenSpecRows(ocr), null);
}

// 6. ★ reviewer ROUND 33 ★ มีคำว่า Average แต่ช่องก่อนวงเล็บไม่ใช่ค่าเฉลี่ยของช่องซ้าย → ข้ามแถวนั้น
{
  const ocr = [
    "(1)  |  (2)  |  (3)  |  Average",
    "A  |  10  |  10  |  10  |  99  |  (0~200)",
    "B  |  20  |  20  |  20  |  20  |  (0~200)",
    "C  |  30  |  30  |  30  |  30  |  (0~200)",
    "D  |  40  |  40  |  40  |  40  |  (0~200)",
  ].join("\n");
  const res = recoverParenSpecRows(ocr);
  check("แถวที่เลขไม่ใช่ค่าเฉลี่ย → ตัดทิ้ง", res?.rows, 3);
  check("ไม่มีแถว A", res?.items.some((i) => i.name === "A"), false);
}

// 4. เจอน้อยกว่า 3 แถว → หลักฐานไม่พอ
{
  const ocr = ["A  |  1  |  2  |  3  |  2  |  (1~5)", "B  |  x"].join("\n");
  check("< 3 แถว → abstain", recoverParenSpecRows(ocr), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
