// print-based test: npx ts-node shared-spec-cell.test.ts
// ยืนยัน: แถวที่ช่องเกณฑ์บนใบว่างเพราะช่องของแถวล่างคร่อมขึ้นมา ได้เกณฑ์นั้นไปใช้ · ใบทรงอื่นไม่ถูกแตะ
import { applySharedSpecCells } from "./shared-spec-cell";
import { OcrToken } from "./rapidocr.service";
import { RawCoaItem } from "./ollama-coa.service";

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// พิกัดจริงจาก PAG-80.pdf (rapidocr, 2000px wide) — หัว Spec y=577 · ชื่อ x≈250 · ผล x≈900 · เกณฑ์ x≈1770
const tok = (text: string, x: number, x2: number, y: number): OcrToken => ({
  text,
  score: 0.99,
  x,
  x2,
  y,
  y1: y - 28,
  y2: y + 28,
});

const PAG80: OcrToken[] = [
  tok("Spec", 1621, 1729, 577),
  tok("Volatile matter", 132, 450, 661), tok("0.04", 844, 956, 659), tok("Max0. 50", 1693, 1851, 654),
  tok("Ash", 128, 207, 752), tok("0.07", 842, 956, 749), tok("Max0.20", 1693, 1851, 745),
  tok("Fixed carbon", 131, 392, 840), tok("99.89", 822, 953, 840), tok("Min99.30", 1673, 1849, 835),
  tok("+850μm", 128, 294, 932), tok("0.0", 868, 957, 930), tok("Max0. 5", 1713, 1854, 925),
  tok("-850+300 μm", 148, 374, 1022), tok("11.9", 844, 956, 1020),
  tok("-300+250μm", 145, 374, 1112), tok("16.8", 847, 956, 1109), tok("20. 0~30. 0", 1635, 1851, 1104),
  tok("-250+180μm", 141, 372, 1202), tok("48.3", 847, 956, 1200),
  tok("-180+150μm", 136, 372, 1292), tok("18.3", 848, 955, 1289), tok("60. 0~70. 0", 1636, 1849, 1286),
  tok("-150μm", 134, 294, 1383), tok("4.7", 868, 957, 1380), tok("Max10. 0", 1693, 1854, 1376),
];

const mkItems = (): RawCoaItem[] => [
  { name: "Volatile matter", unit: "%", specRaw: "Max0. 50", result: "0.04" },
  { name: "Ash", unit: "%", specRaw: "Max0.20", result: "0.07" },
  { name: "Fixed carbon", unit: "%", specRaw: "Min99.30", result: "99.89" },
  { name: "+850μm", unit: "%", specRaw: "Max0. 5", result: "0.0" },
  { name: "-850+300 μm", unit: "%", specRaw: null, result: "11.9" },
  { name: "-300+250μm", unit: "%", specRaw: "20. 0~30. 0", result: "16.8" },
  { name: "-250+180μm", unit: "%", specRaw: null, result: "48.3" },
  { name: "-180+150μm", unit: "%", specRaw: "60. 0~70. 0", result: "18.3" },
  { name: "-150μm", unit: "%", specRaw: "Max10. 0", result: "4.7" },
];

// [1] เคสจริง PAG-80 — 2 แถวที่ช่องเกณฑ์ว่าง ได้เกณฑ์ของช่องที่คร่อมมันอยู่
{
  const items = mkItems();
  const r = applySharedSpecCells(items, PAG80);
  check("เติม 2 แถว", r.shared.length, 2);
  check("-850+300 ได้เกณฑ์ของ -300+250", items[4].specRaw, "20. 0~30. 0");
  check("-250+180 ได้เกณฑ์ของ -180+150", items[6].specRaw, "60. 0~70. 0");
  check("ปักธงว่าเกณฑ์มาจากช่องบนใบ", [items[4].specFromCell, items[4].specShared], [true, true]);
  check("แถวที่มีเกณฑ์อยู่แล้วไม่ถูกแตะ", items[5].specRaw, "20. 0~30. 0");
  check("บอกที่มาได้", r.shared.map((x) => x.from).sort(), ["-180+150μm", "-300+250μm"]);
}

// [2] ไม่มี token (หน้า text-layer) → ไม่แตะเลย
{
  const items = mkItems();
  const r = applySharedSpecCells(items, undefined);
  check("ไม่มี token → ไม่แตะ", r.shared.length, 0);
  check("เกณฑ์ยังว่างตามเดิม", items[4].specRaw, null);
}

// [3] ไม่มีหัว Spec → ไม่รู้ว่าคอลัมน์ไหนคือเกณฑ์ → ถอย
{
  const items = mkItems();
  const r = applySharedSpecCells(items, PAG80.filter((t) => t.text !== "Spec"));
  check("ไม่มีหัว Spec → ไม่แตะ", r.shared.length, 0);
}

// [4] หัว Spec โผล่ 2 ที่ = อ่านคนละตาราง → ถอย
{
  const items = mkItems();
  const r = applySharedSpecCells(items, [...PAG80, tok("Spec", 1621, 1729, 2400)]);
  check("หัว Spec ซ้ำ → ไม่แตะ", r.shared.length, 0);
}

// [5] แถวที่ช่องเกณฑ์ว่างแต่ไม่มีค่าผล (แถวหัวข้อ/แถวว่าง) → ไม่เติม
{
  const toks = PAG80.filter((t) => t.text !== "11.9");
  const items = mkItems();
  const r = applySharedSpecCells(items, toks);
  check("ไม่มีค่าผล → ไม่เติมแถวนั้น", r.shared.map((x) => x.name), ["-250+180μm"]);
  check("-850+300 เกณฑ์ยังว่าง", items[4].specRaw, null);
}

// [6] แถวว่างคั่นห่างเกิน 1.5 เท่าของระยะแถว = คนละบล็อกของใบ → ไม่ยืมข้ามไป
{
  const toks = PAG80.map((t) =>
    t.y === 1022 || t.y === 1020 ? { ...t, y: t.y - 220, y1: t.y1 - 220, y2: t.y2 - 220 } : t
  );
  const items = mkItems();
  const r = applySharedSpecCells(items, toks);
  check("อยู่ไกลเกิน → ไม่ยืมเกณฑ์", items[4].specRaw, null);
  check("แถวที่ยังติดกันยังเติมได้", items[6].specRaw, "60. 0~70. 0");
}

// [7] ใบปกติที่ทุกแถวมีเกณฑ์ของตัวเอง → no-op
{
  const toks = PAG80.filter((t) => t.text !== "-850+300 μm" && t.text !== "11.9" && t.text !== "-250+180μm" && t.text !== "48.3");
  const items = mkItems().filter((i) => i.specRaw != null);
  const r = applySharedSpecCells(items, toks);
  check("ทุกแถวมีเกณฑ์ → ไม่แตะ", r.shared.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
