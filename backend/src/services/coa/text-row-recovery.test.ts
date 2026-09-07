// print-based test: npx ts-node text-row-recovery.test.ts
import { EvaluatedItem } from "./coa-evaluator";
import { recoverSplitTextRows } from "./text-row-recovery";

// text-layer จริงของ TXAX-A — cell สองภาษาถูกตัดเป็น 4 บรรทัด (เกณฑ์ 2 ผล 2)
const TXAX_OCR = [
  "検査項目   Test Item | 規格値 | Specification | 測定値 | Inspected Results",
  "色相   Color",
  "淡黄色",
  "Light Yellow Color",
  "淡黄色",
  "Light Yellow Color",
  "結晶相   Chemical Formula | K 2 Ti 6 O 13",
].join("\n");

function row(name: string, specRaw: string, resultRaw: string): EvaluatedItem {
  return {
    name,
    unit: null,
    method: null,
    min: null,
    max: null,
    result: null,
    status: "SKIP",
    reason: "อ่านเกณฑ์ (spec) เป็นตัวเลขไม่ได้ — ข้ามรายการนี้",
    specRaw,
    resultRaw,
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

// 1. เคสจริง: เกณฑ์ได้บรรทัดญี่ปุ่น ผลได้บรรทัดอังกฤษ แต่ใบเขียนทั้งคู่ทั้งสองช่อง
{
  const rows = [row("色相", "淡黄色", "Light Yellow Color")];
  const res = recoverSplitTextRows(rows, TXAX_OCR);
  check("กู้ 1 แถว", res.recovered.length, 1);
  check("เป็น PASS", rows[0].status, "PASS");
}

// 2. ข้อความต่างกันจริง (ใบเขียนคนละค่า) → คงเป็น SKIP
{
  const ocr = ["Colour | White | Yellow"].join("\n");
  const rows = [row("Colour", "White", "Yellow")];
  const res = recoverSplitTextRows(rows, ocr);
  check("ค่าต่างกันจริง → คง SKIP", res.recovered.length, 0);
  check("status เดิม", rows[0].status, "SKIP");
}

// 3. ท่อนหนึ่งโผล่ครั้งเดียว = อยู่ข้างเดียว → ไม่กู้
{
  const ocr = ["APPEARANCE", "Free Flowing Powder", "Free Flowing Powder", "no Lumb"].join("\n");
  const rows = [row("APPEARANCE", "Free Flowing Powder", "no Lumb")];
  const res = recoverSplitTextRows(rows, ocr);
  check("ผลโผล่ครั้งเดียว → ไม่กู้", res.recovered.length, 0);
}

// 4. ทั้งเกณฑ์และผลโผล่ 2 ครั้งในบล็อกเดียว (TSC: cell ถูกตัดเป็น 2 บรรทัด) → กู้
{
  const ocr = [
    "APPEARANCE | FreeFlowingPowder， | FreeFlowingPowder，",
    "noLumbornoForeignMatter | noLumbornoForeignMatter",
  ].join("\n");
  const rows = [row("APPEARANCE", "FreeFlowingPowder", "noLumbornoForeignMatter")];
  const res = recoverSplitTextRows(rows, ocr);
  check("สองท่อนอยู่ครบทั้งสองช่อง → กู้", res.recovered.length, 1);
}

// 5. แถวที่มีค่าตัวเลขอยู่แล้ว → ไม่ใช่แถวข้อความ ห้ามแตะ
{
  const rows = [row("pH", "7.0 ~ 9.0", "7.7")];
  rows[0].result = 7.7;
  const res = recoverSplitTextRows(rows, TXAX_OCR);
  check("แถวตัวเลข → ไม่แตะ", res.recovered.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
