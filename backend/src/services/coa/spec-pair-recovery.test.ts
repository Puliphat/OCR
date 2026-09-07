// print-based test: npx ts-node spec-pair-recovery.test.ts
import { RawCoaItem } from "./ollama-coa.service";
import { recoverSpecPairs } from "./spec-pair-recovery";

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
