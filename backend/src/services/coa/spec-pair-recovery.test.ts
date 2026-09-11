// print-based test: npx ts-node spec-pair-recovery.test.ts
import { RawCoaItem } from "./ollama-coa.service";
import { recoverSpecPairs } from "./spec-pair-recovery";
import { OcrToken } from "./rapidocr.service";

// พิกัดจริงจาก RapidOCR หน้า 1 ของ CIIR1066 (ดู _validate/_dump-tokens.ts) — ช่องเกณฑ์ต่ำ cx≈1386 สูง cx≈1644
const tok = (text: string, x: number, x2: number, y: number): OcrToken => ({
  text, score: 0.99, x, x2, y, y1: y - 20, y2: y + 20,
});
const COL = { unit: [659, 693], avg: [830, 913], rmax: [979, 1065], rmin: [1132, 1216], lo: [1342, 1429], hi: [1602, 1686] };
function tokenRow(name: string, y: number, avg: string, rmax: string, rmin: string, lo: string | null, hi: string | null): OcrToken[] {
  const out = [tok(name, 207, 564, y), tok("%", COL.unit[0], COL.unit[1], y),
    tok(avg, COL.avg[0], COL.avg[1], y), tok(rmax, COL.rmax[0], COL.rmax[1], y), tok(rmin, COL.rmin[0], COL.rmin[1], y)];
  if (lo) out.push(tok(lo, COL.lo[0], COL.lo[1], y));
  if (hi) out.push(tok(hi, COL.hi[0], COL.hi[1], y));
  return out;
}
const CIIR_TOKENS: OcrToken[] = [
  ...tokenRow("MOONEY ML 1+8 @ 125C", 820, "39", "39", "38", "34", "42"),
  ...tokenRow("ANTIOXIDANT", 881, "0.03", "0.04", "0.03", "0.02", null),
  ...tokenRow("CHLORINE", 942, "1.27", "1.28", "1.25", "1.18", "1.34"),
];

// OCR จริงของ CIIR1066 — เกณฑ์ "34 - 42" ถูกอ่านเป็นสองช่องเพราะขีดกลางหาย
const CIIR_OCR = [
  "Results",
  "Property  |  Unit  |  Avg.  |  Max.  |  Min.  |  Specification",
  "MOONEY ML 1+8 @ 125C  |  39  |  39  |  38  |  34  |  42",
  "ANTIOXIDANT  |  %   |  0.03  |  0.04  |  0.03  |  0.02",
  "CHLORINE  |  %  |  1.27  |  1.28  |  1.25  |  1.18  |  1.34",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: LLM เก็บเกณฑ์มาข้างเดียว (42) → เติมเป็นช่วง 34~42
{
  const items: RawCoaItem[] = [
    { name: "MOONEY ML 1+8 @ 125C", specRaw: "42", result: "39" },
    { name: "CHLORINE", specRaw: "1.18~1.34", result: "1.27" },
  ];
  const res = recoverSpecPairs(items, CIIR_OCR);
  check("เติม 1 แถว", res.paired.length, 1);
  check("MOONEY ได้ช่วงเต็ม", items[0].specRaw, "34~42");
  check("แถวที่เกณฑ์ครบอยู่แล้วไม่ถูกแตะ", items[1].specRaw, "1.18~1.34");
}

// 2. เกณฑ์เหลือช่องเดียวบนใบจริง (ANTIOXIDANT มี min อย่างเดียว) → ตัดสินทิศไม่ได้ ห้ามเดา
{
  const items: RawCoaItem[] = [{ name: "ANTIOXIDANT", specRaw: "0.02", result: "0.03" }];
  const res = recoverSpecPairs(items, CIIR_OCR);
  check("ช่องเกณฑ์ไม่ครบคู่ → ไม่แตะ", res.paired.length, 0);
}

// 3. ค่าที่ LLM เก็บมาไม่ใช่ขอบของคู่นั้น (หยิบ Min ของค่าผลมา) → ไม่แตะ
{
  const items: RawCoaItem[] = [{ name: "MOONEY ML 1+8 @ 125C", specRaw: "38", result: "39" }];
  const res = recoverSpecPairs(items, CIIR_OCR);
  check("ค่าไม่ใช่ขอบเกณฑ์ → ไม่แตะ", res.paired.length, 0);
}

// 4. ใบที่ไม่มี header เกณฑ์ท้ายแถว (Imerys: Characteristics|Methods|Analysis Results|Unit) → abstain
{
  const ocr = ["Characteristics  |  Methods  |  Analysis Results  |  Unit", "Ash  |  |  0.07  |  %"].join("\n");
  const items: RawCoaItem[] = [{ name: "Ash", specRaw: "0.07", result: "0.07" }];
  const res = recoverSpecPairs(items, ocr);
  check("ไม่มี header เกณฑ์ → ไม่แตะ", res.paired.length, 0);
}

// 5. ค่าผลขัดกับ role ที่ header บอก (max < min) → แบ่งช่องผิด ห้ามเชื่อ
{
  const ocr = [
    "Property  |  Avg.  |  Max.  |  Min.  |  Specification",
    "ITEM  |  39  |  30  |  38  |  34  |  42",
  ].join("\n");
  const items: RawCoaItem[] = [{ name: "ITEM", specRaw: "42", result: "39" }];
  const res = recoverSpecPairs(items, ocr);
  check("ค่าผลขัด role → ไม่แตะ", res.paired.length, 0);
}

// 6. เคสจริง CIIR1066: มีพิกัด token แล้ว → รู้ว่า 0.02 นั่งช่องต่ำ = เกณฑ์ขั้นต่ำ
{
  const items: RawCoaItem[] = [{ name: "ANTIOXIDANT", specRaw: "0.02", result: "0.03" }];
  const res = recoverSpecPairs(items, CIIR_OCR, CIIR_TOKENS);
  check("กู้ทิศได้ 1 แถว", res.paired.map((p) => p.to), ["≥0.02"]);
  check("เป็นขอบล่าง", [items[0].specMin, items[0].specMax, items[0].specRaw], [0.02, null, null]);
  check("นับเป็นเกณฑ์ที่อ่านจากช่องจริง", items[0].specFromCell, true);
}

// 7. เลขตัวเดียวนั่งช่องสูงแทน → ต้องได้ขอบบน ไม่ใช่ขอบล่าง
{
  const tokens = [
    ...tokenRow("MOONEY ML 1+8 @ 125C", 820, "39", "39", "38", "34", "42"),
    ...tokenRow("ANTIOXIDANT", 881, "0.03", "0.04", "0.03", null, "0.02"),
    ...tokenRow("CHLORINE", 942, "1.27", "1.28", "1.25", "1.18", "1.34"),
  ];
  const items: RawCoaItem[] = [{ name: "ANTIOXIDANT", specRaw: "0.02", result: "0.03" }];
  const res = recoverSpecPairs(items, CIIR_OCR, tokens);
  check("นั่งช่องสูง → ขอบบน", res.paired.map((p) => p.to), ["≤0.02"]);
  check("เขียนลง specMax", [items[0].specMin, items[0].specMax], [null, 0.02]);
}

// 8. เลขตกกลางระหว่างสองช่อง — พิสูจน์ไม่ได้ว่าช่องไหน ห้ามเดา
{
  const tokens = [
    ...tokenRow("MOONEY ML 1+8 @ 125C", 820, "39", "39", "38", "34", "42"),
    ...tokenRow("ANTIOXIDANT", 881, "0.03", "0.04", "0.03", null, null),
    ...tokenRow("CHLORINE", 942, "1.27", "1.28", "1.25", "1.18", "1.34"),
    tok("0.02", 1480, 1550, 881),
  ];
  const items: RawCoaItem[] = [{ name: "ANTIOXIDANT", specRaw: "0.02", result: "0.03" }];
  const res = recoverSpecPairs(items, CIIR_OCR, tokens);
  check("ตกกลางสองช่อง → ไม่แตะ", res.paired.length, 0);
}

// 9. มีแถวที่พิมพ์ครบคู่แค่แถวเดียว — ยืนยันตำแหน่งคอลัมน์ไม่ได้ ถอยทั้งใบ
{
  const tokens = [
    ...tokenRow("MOONEY ML 1+8 @ 125C", 820, "39", "39", "38", "34", "42"),
    ...tokenRow("ANTIOXIDANT", 881, "0.03", "0.04", "0.03", "0.02", null),
  ];
  const items: RawCoaItem[] = [{ name: "ANTIOXIDANT", specRaw: "0.02", result: "0.03" }];
  const res = recoverSpecPairs(items, CIIR_OCR, tokens);
  check("แถวครบคู่แถวเดียว → ไม่แตะ", res.paired.length, 0);
}

// 10. แถวครบคู่ที่ช่องซ้ายมากกว่าช่องขวา = อ่านผิดตาราง → ถอยทั้งใบ
{
  const tokens = [
    ...tokenRow("MOONEY ML 1+8 @ 125C", 820, "39", "39", "38", "42", "34"),
    ...tokenRow("ANTIOXIDANT", 881, "0.03", "0.04", "0.03", "0.02", null),
    ...tokenRow("CHLORINE", 942, "1.27", "1.28", "1.25", "1.18", "1.34"),
  ];
  const items: RawCoaItem[] = [{ name: "ANTIOXIDANT", specRaw: "0.02", result: "0.03" }];
  const res = recoverSpecPairs(items, CIIR_OCR, tokens);
  check("ช่องซ้าย > ช่องขวา → ไม่แตะ", res.paired.length, 0);
}

// 11. หน้า text-layer (ไม่มี token) ยังต้องถอยเหมือนเดิม — กันการเดาทิศจากลำดับ cell
{
  const items: RawCoaItem[] = [{ name: "ANTIOXIDANT", specRaw: "0.02", result: "0.03" }];
  check("ไม่มี token → ไม่แตะ", recoverSpecPairs(items, CIIR_OCR, []).paired.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
