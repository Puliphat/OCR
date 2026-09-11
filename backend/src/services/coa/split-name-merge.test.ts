// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node split-name-merge.test.ts
import { RawCoaItem } from "./ollama-coa.service";
import { mergeSplitNameRows } from "./split-name-merge";

// OCR จริงของ TAIHEIYO CMF — "Bulk Density(kg/1)" ถูกตัดเป็น 2 ช่องบนบรรทัดเดียว
const TAIHEIYO_OCR = [
  "Fiber Diameter (μm)  |  5.2  |  5 ± 0.5",
  "SG(kg/1)  |  2.8  |  2.8±0.1",
  "Bulk  |  Density(kg/1)  |  0.34  |  Spec  |  0.30 ± 0.08",
  "Shot Content (wt%)  |  0.37  |  1≥",
  "Moisture(%)  |  0.10  |  0.5≥",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: แถวผี "Density(kg/1)" ยืมเลข 0.30 จากเกณฑ์ของ "Bulk" มาเป็นค่า
{
  const items: RawCoaItem[] = [
    { name: "Fiber Diameter (μm)", specRaw: "5 ± 0.5", result: "5.2" },
    { name: "Bulk", specRaw: "0.30 ± 0.08", result: "0.34" },
    { name: "Density(kg/1)", result: "0.3" },
    { name: "Shot Content (wt%)", specRaw: "1≥", result: "0.37" },
  ];
  const res = mergeSplitNameRows(items, TAIHEIYO_OCR);
  check("ตัดแถวผีทิ้ง 1 แถว", res.items.length, 3);
  check("ชื่อกลับมาเต็ม", res.items[1].name, "Bulk Density(kg/1)");
  check("ค่าและเกณฑ์ของแถวจริงไม่ถูกแตะ", [res.items[1].result, res.items[1].specRaw], ["0.34", "0.30 ± 0.08"]);
  check("รายงานสิ่งที่ตัด", res.merged.length, 1);
}

// 2. ★ แถวหลังถือค่าวัดของตัวเอง (ไม่ใช่เลขที่ยืมจากเกณฑ์) → ห้ามตัด ★ ไม่งั้นค่าจริงบนใบหายไป
{
  const items: RawCoaItem[] = [
    { name: "Bulk", specRaw: "0.30 ± 0.08", result: "0.34" },
    { name: "Density(kg/1)", result: "0.77" },
  ];
  const res = mergeSplitNameRows(items, TAIHEIYO_OCR);
  check("ค่าของตัวเอง = เก็บไว้", res.items.length, 2);
}

// 3. แถวหลังมีเกณฑ์ของตัวเอง = เป็นรายการจริง ห้ามตัด
{
  const items: RawCoaItem[] = [
    { name: "Bulk", specRaw: "0.30 ± 0.08", result: "0.34" },
    { name: "Density(kg/1)", specRaw: "0.2~0.5", result: "0.3" },
  ];
  const res = mergeSplitNameRows(items, TAIHEIYO_OCR);
  check("มีเกณฑ์ของตัวเอง = เก็บไว้", res.items.length, 2);
}

// 4. ชื่ออยู่คนละบรรทัดบน OCR = คนละรายการจริง ห้ามรวม
{
  const items: RawCoaItem[] = [
    { name: "SG(kg/1)", specRaw: "2.8±0.1", result: "2.8" },
    { name: "Moisture(%)", result: "2.8" },
  ];
  const res = mergeSplitNameRows(items, TAIHEIYO_OCR);
  check("คนละบรรทัด = เก็บไว้", res.items.length, 2);
}

// 5. ตารางปกติที่ทุกแถวมีเกณฑ์ครบ → ไม่มีอะไรถูกแตะ
{
  const items: RawCoaItem[] = [
    { name: "Fiber Diameter (μm)", specRaw: "5 ± 0.5", result: "5.2" },
    { name: "SG(kg/1)", specRaw: "2.8±0.1", result: "2.8" },
    { name: "Moisture(%)", specRaw: "0.5≥", result: "0.10" },
  ];
  const res = mergeSplitNameRows(items, TAIHEIYO_OCR);
  check("ตารางปกติไม่ถูกแตะ", res.merged.length, 0);
}

// 6. แถวหลังไม่มีค่าเลย (ชื่อลอย) → รวมได้ ไม่มีค่าให้เสีย
{
  const items: RawCoaItem[] = [
    { name: "Bulk", specRaw: "0.30 ± 0.08", result: "0.34" },
    { name: "Density(kg/1)" },
  ];
  const res = mergeSplitNameRows(items, TAIHEIYO_OCR);
  check("ชื่อลอยไม่มีค่า = รวม", [res.items.length, res.items[0].name], [1, "Bulk Density(kg/1)"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
