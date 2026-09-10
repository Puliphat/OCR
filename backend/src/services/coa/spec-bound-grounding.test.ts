// print-based test: npx ts-node spec-bound-grounding.test.ts
import { RawCoaItem } from "./ollama-coa.service";
import { dropUngroundedSpecBounds } from "./spec-bound-grounding";

// OCR จริงของ HG-PP#180 — ช่องเกณฑ์ที่ว่างถูกอ่านเป็น "-" หรือคันจิ 一
const HGPP_OCR = [
  "Item  |  Spec  |  Results",
  "Min  |  Max",
  "Chemical Analysis  |  Fe  |  42.0%  |  -  |  42.4%",
  "s  |  46.0%  |  一  |  51.6%",
  "SiO2  |  -  |  6.0%  |  5.1%",
  "-75μm  |  80.0%  |  一  |  99.2%",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: LLM ยืมขอบบนของแถวถัดไปมาใส่ Fe → ต้องเหลือขอบล่างเดียว
{
  const items: RawCoaItem[] = [
    { name: "Fe", specRaw: "42.0% - 46.0%", result: "42.4" },
    { name: "SiO2", specRaw: "6.0 Max.", result: "5.1" },
  ];
  const res = dropUngroundedSpecBounds(items, HGPP_OCR);
  check("ตัด 1 แถว", res.fixed.length, 1);
  check("Fe เหลือขอบล่าง", items[0].specRaw, "42 Min.");
  check("SiO2 ไม่ถูกแตะ", items[1].specRaw, "6.0 Max.");
}

// 2. เกณฑ์ที่อยู่ครบทั้งสองขอบในบรรทัดตัวเอง → ห้ามแตะ
{
  const ocr = ["MOONEY  |  39  |  39  |  38  |  34  |  42", "CHLORINE  |  1.27  |  1.18  |  1.34"].join("\n");
  const items: RawCoaItem[] = [{ name: "MOONEY", specRaw: "34~42", result: "39" }];
  const res = dropUngroundedSpecBounds(items, ocr);
  check("ไม่มีช่องว่าง → ไม่แตะ", res.fixed.length, 0);
  check("เกณฑ์คงเดิม", items[0].specRaw, "34~42");
}

// 3. มีช่องว่างแต่ขอบทั้งสองไม่อยู่ในบรรทัด (คนละบรรทัด) → ตัดสินไม่ได้ ปล่อยไว้
{
  const ocr = ["粒度  |  -  |  結果  |  6.5", "規格  |  5.5  |  7.5"].join("\n");
  const items: RawCoaItem[] = [{ name: "粒度", specRaw: "5.5~7.5", result: "6.5" }];
  const res = dropUngroundedSpecBounds(items, ocr);
  check("ขอบอยู่คนละบรรทัด → ไม่แตะ", res.fixed.length, 0);
}

// 4. ชื่อ match หลายบรรทัด → พิสูจน์ไม่ได้ว่าบรรทัดไหนของแถวนี้
{
  const ocr = ["Iron  |  1.0  |  -  |  0.5", "Iron  |  2.0  |  -  |  1.5"].join("\n");
  const items: RawCoaItem[] = [{ name: "Iron", specRaw: "1.0 - 9.0", result: "0.5" }];
  const res = dropUngroundedSpecBounds(items, ocr);
  check("ชื่อซ้ำหลายบรรทัด → ไม่แตะ", res.fixed.length, 0);
}

// 5. ขอบล่างเป็นตัวยืม ขอบบนอยู่จริง → เหลือขอบบน
{
  const ocr = ["SiO2  |  -  |  6.0%  |  5.1%"].join("\n");
  const items: RawCoaItem[] = [{ name: "SiO2", specRaw: "2.0 - 6.0", result: "5.1" }];
  const res = dropUngroundedSpecBounds(items, ocr);
  check("เหลือขอบบน", items[0].specRaw, "6 Max.");
}

// 6. เกณฑ์ที่โมดูล structural อ่านจากช่องของแถวเอง → ห้ามตัด (คู่ควบคุมกับเคส 5: input เดียวกันเป๊ะ
//    ต่างแค่ธง — ถ้าเคสนี้ยังโดนตัด แปลว่าธงไม่ถูกอ่าน · ถ้าเคส 5 ไม่โดนตัด แปลว่าโมดูลตายทั้งตัว)
{
  const ocr = "SiO2  |  -  |  6.0%  |  5.1%";
  const items: RawCoaItem[] = [
    { name: "SiO2", specRaw: "2.0 - 6.0", result: "5.1", specFromCell: true },
  ];
  const res = dropUngroundedSpecBounds(items, ocr);
  check("ธง specFromCell → ไม่ตัด", res.fixed.length, 0);
  check("เกณฑ์สองขอบคงเดิม", items[0].specRaw, "2.0 - 6.0");
}

// 7. ธงอยู่คนละแถวกับแถวที่ต้องตัด → ตัดเฉพาะแถวที่ไม่มีธง ไม่ใช่ข้ามทั้งใบ
{
  const items: RawCoaItem[] = [
    { name: "Fe", specRaw: "42.0% - 46.0%", result: "42.4" },
    { name: "SiO2", specRaw: "2.0 - 6.0", result: "5.1", specFromCell: true },
  ];
  const res = dropUngroundedSpecBounds(items, HGPP_OCR);
  check("ตัดเฉพาะแถวไม่มีธง", res.fixed.map((f) => f.name), ["Fe"]);
  check("Fe ถูกตัด", items[0].specRaw, "42 Min.");
  check("SiO2 ที่มีธงคงเดิม", items[1].specRaw, "2.0 - 6.0");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
