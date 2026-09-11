// print-based test: npx ts-node method-cell-shift.test.ts
// ยืนยัน: แถวที่ช่อง Test Method บนใบว่าง เกณฑ์ที่ LLM ยัดไปช่องนั้นถูกย้ายกลับ · แถว/ใบอื่นไม่ถูกแตะ
import { fixShiftedMethodCells } from "./method-cell-shift";
import { OcrToken } from "./rapidocr.service";
import { RawCoaItem } from "./ollama-coa.service";

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// พิกัดจริงจาก Kemolit KF-3.pdf (rapidocr, 2000px) — หัวตาราง y=1018
const tok = (text: string, x: number, x2: number, y: number): OcrToken => ({
  text,
  score: 0.99,
  x,
  x2,
  y,
  y1: y - 20,
  y2: y + 20,
});

const KEMOLIT: OcrToken[] = [
  tok("1S.No", 149, 249, 1018),
  tok("Particulars", 395, 567, 1018),
  tok("TestMethod", 767, 969, 1018),
  tok("Specification", 1107, 1310, 1018),
  tok("UOM", 1432, 1527, 1018),
  tok("Results", 1662, 1781, 1018),
  // แถวปกติ: ช่องวิธีทดสอบมีค่า
  tok("1", 179, 207, 1113), tok("Brightness (as compared with", 257, 686, 1113),
  tok("TP/SOH/QC/01/04", 706, 983, 1113), tok("80.00MIN", 1034, 1197, 1112),
  tok("%", 1385, 1429, 1112), tok("80.860", 1568, 1675, 1111),
  // ★ แถวที่ช่องวิธีทดสอบว่าง ★
  tok("4", 180, 209, 1295), tok("ForeignParticles", 259, 504, 1296),
  tok("VISUAL", 1031, 1170, 1294), tok("Absent", 1570, 1678, 1294),
  // แถวปกติอีกแถว
  tok("5", 180, 207, 1342), tok("Moisturecontent", 259, 504, 1342),
  tok("TP/SOH/QC/01/12", 705, 984, 1341), tok("0.30MAX", 1031, 1192, 1341),
  tok("%", 1384, 1429, 1341), tok("0.100", 1568, 1659, 1340),
];

const mkItems = (): RawCoaItem[] => [
  { name: "Brightness (as compared with 100%MgO)", method: "TP/SOH/QC/01/04", specRaw: "80.00 MIN", unit: "%", result: "80.860" },
  { name: "Foreign Particles", method: "VISUAL", specRaw: "Absent", unit: null, result: "Absent" },
  { name: "Moisture content", method: "TP/SOH/QC/01/12", specRaw: "0.30 MAX", unit: "%", result: "0.100" },
];

// [1] เคสจริง Kemolit — VISUAL กลับไปเป็นเกณฑ์ ช่องวิธีทดสอบว่างตามใบ
{
  const items = mkItems();
  const r = fixShiftedMethodCells(items, KEMOLIT);
  check("แก้ 1 แถว", r.fixed.length, 1);
  check("เกณฑ์กลับเป็น VISUAL", items[1].specRaw, "VISUAL");
  check("ช่องวิธีทดสอบว่างตามใบ", items[1].method, null);
  check("ค่าผลไม่ถูกแตะ", items[1].result, "Absent");
  check("ปักธงว่าเกณฑ์มาจากช่องบนใบ", items[1].specFromCell, true);
  check("แถวที่มีวิธีทดสอบจริงไม่ถูกแตะ", [items[0].method, items[0].specRaw], ["TP/SOH/QC/01/04", "80.00 MIN"]);
  check("แถวสุดท้ายไม่ถูกแตะ", [items[2].method, items[2].specRaw], ["TP/SOH/QC/01/12", "0.30 MAX"]);
}

// [2] ไม่มี token (หน้า text-layer) → ไม่แตะ
{
  const items = mkItems();
  const r = fixShiftedMethodCells(items, undefined);
  check("ไม่มี token → ไม่แตะ", r.fixed.length, 0);
  check("ค่าเดิมอยู่ครบ", items[1].specRaw, "Absent");
}

// [3] ไม่มีหัว Test Method → ไม่รู้ว่าคอลัมน์ไหนเป็นอะไร → ถอย
{
  const items = mkItems();
  const r = fixShiftedMethodCells(items, KEMOLIT.filter((t) => t.text !== "TestMethod"));
  check("ไม่มีหัว TestMethod → ไม่แตะ", r.fixed.length, 0);
}

// [4] หัวตารางซ้ำ = อ่านคนละตาราง → ถอย
{
  const items = mkItems();
  const r = fixShiftedMethodCells(items, [...KEMOLIT, tok("Specification", 1107, 1310, 2400)]);
  check("หัว Specification ซ้ำ → ไม่แตะ", r.fixed.length, 0);
}

// [5] ค่าที่ LLM เรียกว่า method ไม่ตรงกับของในช่องเกณฑ์ → ไม่ใช่อาการนี้ ไม่แตะ
{
  const items = mkItems();
  items[1].method = "SOMETHINGELSE";
  const r = fixShiftedMethodCells(items, KEMOLIT);
  check("ข้อความไม่ตรงช่องเกณฑ์ → ไม่แตะ", r.fixed.length, 0);
  check("method เดิมอยู่", items[1].method, "SOMETHINGELSE");
}

// [6] ใบที่ช่องวิธีทดสอบมีค่าจริงทั้งคอลัมน์ → no-op
{
  const items = mkItems().filter((i) => i.name !== "Foreign Particles");
  const r = fixShiftedMethodCells(items, KEMOLIT);
  check("ทุกแถวมีวิธีทดสอบ → ไม่แตะ", r.fixed.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
