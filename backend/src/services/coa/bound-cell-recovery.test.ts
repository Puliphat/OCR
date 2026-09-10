// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node bound-cell-recovery.test.ts
import { RawCoaItem } from "./ollama-coa.service";
import { recoverSplitBoundCells } from "./bound-cell-recovery";

// OCR จริงของ Zirconium Silicate MZ-1000B — คำว่า Max/Min หลุดมาเป็นช่องของตัวเอง
const ZR_OCR = [
  "Item  |  Unit  |  Specification  |  Analysis Result",
  "ZrO2+HfO2  |  %   |  64.30~ 66.30  |  65.27",
  "S-Fe2O3  |  %   |  0.020  |  Max  |  0.007",
  "45μm pass  |  %   |  95.0  |  Min  |  99.0",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: LLM ได้ result="Max" → ต่อคำกลับเข้าเกณฑ์ แล้วเอาเลขถัดไปเป็นค่าผล
{
  const items: RawCoaItem[] = [
    { name: "S-Fe2O3", specRaw: "0.020", result: "Max" },
    { name: "45μm pass", specRaw: "95.0", result: "Min" },
  ];
  const res = recoverSplitBoundCells(items, ZR_OCR);
  check("แก้ 2 แถว", res.fixed.length, 2);
  check("S-Fe2O3 เกณฑ์ 0.020 Max ผล 0.007", [items[0].specRaw, items[0].result], ["0.020 Max", 0.007]);
  check("45μm pass เกณฑ์ 95.0 Min ผล 99.0", [items[1].specRaw, items[1].result], ["95.0 Min", 99]);
}

// 2. แถวที่อ่านค่าผลได้อยู่แล้ว → ไม่แตะ
{
  const items: RawCoaItem[] = [{ name: "ZrO2+HfO2", specRaw: "64.30~66.30", result: 65.27 }];
  const res = recoverSplitBoundCells(items, ZR_OCR);
  check("แถวปกติ → ไม่แตะ", res.fixed.length, 0);
  check("ค่าเดิมอยู่ครบ", items[0].result, 65.27);
}

// 3. ไม่มีช่อง Max/Min ลอย → ไม่แตะ
{
  const ocr = "Moisture  |  %  |  2 max  |  0.71";
  const items: RawCoaItem[] = [{ name: "Moisture", specRaw: "2 max", result: "-" }];
  const res = recoverSplitBoundCells(items, ocr);
  check("ไม่มีช่องลอย → ไม่แตะ", res.fixed.length, 0);
}

// 4. ช่องข้าง Max ไม่ใช่ตัวเลข → ไม่เดา
{
  const ocr = "Colour  |  White  |  Max  |  Off-white";
  const items: RawCoaItem[] = [{ name: "Colour", specRaw: "White", result: "Max" }];
  const res = recoverSplitBoundCells(items, ocr);
  check("ข้างๆ ไม่ใช่เลข → ไม่แตะ", res.fixed.length, 0);
}

// 5. ★ reviewer ROUND 33 ★ เกณฑ์สองฝั่งบนบรรทัดเดียว → เดาไม่ออกว่าช่องไหนคือผล ห้ามหยิบ
{
  const ocr = "Purity  |  99.0  |  Min  |  99.9  |  Max  |  99.5";
  const items: RawCoaItem[] = [{ name: "Purity", specRaw: "99.0", result: "Min" }];
  const res = recoverSplitBoundCells(items, ocr);
  check("สองขอบ → ไม่แตะ", res.fixed.length, 0);
  check("ไม่ยัดค่าผลผิดช่อง", items[0].result, "Min");
}

// 6. ★ reviewer ROUND 33 ★ LLM อ่านเกณฑ์สองฝั่งมาถูกแล้ว ค่าผลเสียอย่างเดียว → ห้ามทับเกณฑ์ด้วยขอบเดียว
{
  const ocr = "Assay  |  %  |  95.0  |  Min  |  99.0";
  const items: RawCoaItem[] = [{ name: "Assay", specMin: 95, specMax: 98, specRaw: "95~98", result: "Min" }];
  const res = recoverSplitBoundCells(items, ocr);
  check("เติมเฉพาะค่าผล", items[0].result, 99);
  check("เกณฑ์สองฝั่งเดิมอยู่ครบ", [items[0].specMin, items[0].specMax], [95, 98]);
}

// 7. ค่าที่หยิบต้องเป็นเลขท้ายบรรทัด (ไม่ใช่ช่องกลางตาราง)
{
  const ocr = "Item  |  0.020  |  Max  |  0.007  |  0.500";
  const items: RawCoaItem[] = [{ name: "Item", specRaw: "0.020", result: "Max" }];
  const res = recoverSplitBoundCells(items, ocr);
  check("มีเลขต่อท้ายอีก → ไม่แตะ", res.fixed.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
