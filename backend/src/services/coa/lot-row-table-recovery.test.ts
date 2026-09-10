// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node lot-row-table-recovery.test.ts
import { recoverLotRowTable } from "./lot-row-table-recovery";

// OCR จริงของ Mica 200-S (2 ล็อตในตารางเดียว) — เดิม LLM ได้ Humidity=26 เกณฑ์ 15~30 = ผิดทั้งคู่
const MICA_OCR = [
  "CERTIFICATEOFANALYSIS",
  "1.GRADE  |  ：SUZORITEMICA200-S",
  "Item  |  Sieve Analysis  |  Loose Bulk  |  Density  |  Humidity",
  "Method  |  ASTME 11-87/ASTMC136-84  |  ASTM D  |  716-86  |  ASTM D  |  1864-81",
  "(Mesh, wt%)  |  (lb/cu-ft)  |  (%)",
  "Specifications  |  Traces  |  +60  |  -60/+100-100/+200-200/+325  |  Max 1  |  15~30  |  20~35  |  -325  |  45~60  |  10.0~18.2  |  0.00~0.50",
  "LOT No.854416  |  Traces  |  Traces  |  22.4  |  26.0  |  51.6  |  14.4  |  0.19",
  "LOT No.854429  |  Traces  |  Traces  |  23.6  |  27.6  |  48.8  |  17.5  |  0.19",
].join("\n");

// text-layer ของ 325-HK มาแบบกระจัดกระจาย (บรรทัดล็อตขาดค่า) → ต้อง abstain ไม่ใช่เดา
const HK_TEXT = [
  "Item | Sieve Analysis",
  "Specifications",
  "+100 | -100/＋200",
  "Max 1 | Max 5 | 92～100",
  "LOT NO. 850993 | Traces | 1.50 | 92.50 | 11.4",
  "LOT NO. 850997 | Traces | 0.90 | 95.45 | 12.2 | 0.26",
].join("\n");

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. เคสจริง: 2 ล็อต × 7 คอลัมน์ = 14 แถว จับคู่เกณฑ์กับค่าตามตำแหน่ง
{
  const res = recoverLotRowTable(MICA_OCR);
  check("อ่านได้", res != null, true);
  check("ได้ 14 แถว (2 ล็อต × 7)", res?.items.length, 14);
  check("เจอ 2 ล็อต", res?.lots, ["LOT No.854416", "LOT No.854429"]);
  const first = res!.items[0];
  check("แถวแรก: +60 เกณฑ์ Traces ผล Traces", [first.name, first.specRaw, first.result], ["LOT No.854416 +60", "Traces", "Traces"]);
  const humid = res!.items[6];
  check("แถวสุดท้ายของล็อตแรก = Humidity 0.19 เกณฑ์ 0.00~0.50",
    [humid.name, humid.specRaw, humid.result], ["LOT No.854416 Humidity", "0.00~0.50", "0.19"]);
  const mesh200 = res!.items[2];
  check("-100/+200 เกณฑ์ 15~30 ผล 22.4",
    [mesh200.name, mesh200.specRaw, mesh200.result], ["LOT No.854416 -100/+200", "15~30", "22.4"]);
  const lot2 = res!.items[9];
  check("ล็อตสองแถว -100/+200 ผล 23.6", [lot2.name, lot2.result], ["LOT No.854429 -100/+200", "23.6"]);
}

// 2. จำนวนช่องไม่เท่ากัน (text-layer กระจัดกระจาย) → abstain ทั้งใบ
{
  check("325-HK text-layer → ไม่เดา", recoverLotRowTable(HK_TEXT), null);
}

// 3. ไม่มีบรรทัด Specifications → ไม่ใช่ layout นี้
{
  const ocr = ["Item | Spec | Result", "Moisture | 2 max | 0.71"].join("\n");
  check("ใบปกติ → ไม่แตะ", recoverLotRowTable(ocr), null);
}

// 5. Vermitech: แถวเกณฑ์ "spec." + แถวสรุป "平均" — ต้องหยิบแถวเฉลี่ย ไม่ใช่ sample แรก
{
  const ocr = [
    "試料  |  水分  |  見排比重  |  粒度分布  |  JIS",
    "sample  |  moisture  |  pH  |  bulk density  |  ScreenAnalysis(JISSieveMesh)",
    "No.  |  %  |  g/ml  |  12  |  16  |  32  |  48  |  60  |  80  |  pan  |  total",
    "spec.  |  0.0-6.0  |  7.5-10.8  |  0.100-0.150  |  0  |  1-10  |  40-90  |  10-50  |  0-10  |  0-8  |  0-6  |  100%",
    "1  |  0.58  |  9.30  |  0.127  |  0.0  |  1.2  |  63.1  |  23.2  |  3.2  |  4.2  |  5.1  |  100%",
    "平均  |  0.48  |  8.87  |  0.125  |  0.0  |  2.1  |  65.3  |  21.1  |  2.9  |  4.0  |  4.6  |  100%",
  ].join("\n");
  const res = recoverLotRowTable(ocr);
  check("อ่านตารางแนวนอนได้", res != null, true);
  check("11 คอลัมน์", res?.items.length, 11);
  check("ใช้ค่าจากแถว 平均 ไม่ใช่ sample 1",
    [res?.items[0].name, res?.items[0].result, res?.items[0].specRaw], ["moisture", "0.48", "0.0-6.0"]);
  check("pH จากแถวเฉลี่ย", [res?.items[1].name, res?.items[1].result], ["pH", "8.87"]);
  check("ตะแกรง 32 เกณฑ์ 40-90", [res?.items[5].name, res?.items[5].result, res?.items[5].specRaw], ["32", "65.3", "40-90"]);
}

// 4. เกณฑ์น้อยกว่า 3 ช่อง → หลักฐานไม่พอ
{
  const ocr = ["Specifications | Max 1 | 15~30", "LOT No.1 | 0.5 | 20"].join("\n");
  check("เกณฑ์ < 3 → abstain", recoverLotRowTable(ocr), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
