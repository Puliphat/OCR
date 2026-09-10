// OCR แยกคำว่า Max/Min ออกมาเป็นช่องของตัวเอง ("0.020 | Max | 0.007") → LLM หยิบคำนั้นมาเป็นค่าผล
//   แล้วทั้งแถวกลายเป็น SKIP ทั้งที่ใบอ่านออกครบ — ต่อคำกลับเข้ากับเลขเกณฑ์ แล้วเอาเลขถัดไปเป็นค่าผล
import { RawCoaItem } from "./ollama-coa.service";
import { splitCells } from "./column-shift-recovery";
import { NUM_PATTERN, toNum } from "./numeric";

const LONE_BOUND = /^(max|min)\.?$/i;
const LONE_NUM = new RegExp(`^(${NUM_PATTERN})\\s*%?$`);

export interface BoundCellResult {
  fixed: { name: string; spec: string; result: number }[];
}

function nameKey(s: string): string {
  return s.toLowerCase().replace(/[\s()%+\-]/g, "");
}

function numAt(cell: string | undefined): number | null {
  const t = (cell ?? "").trim().replace(/\s*%$/, "");
  if (!LONE_NUM.test(t)) return null;
  const n = toNum(t);
  return Number.isFinite(n) ? n : null;
}

export function recoverSplitBoundCells(items: RawCoaItem[], text: string): BoundCellResult {
  const fixed: BoundCellResult["fixed"] = [];
  if (!items.length || !text) return { fixed };
  const lines = text.split("\n");

  for (const it of items) {
    const resultNum = numAt(String(it.result ?? ""));
    if (resultNum != null) continue; // แถวนี้อ่านค่าผลได้อยู่แล้ว

    const key = nameKey(String(it.name ?? ""));
    if (!key) continue;
    const line = lines.find((l) => {
      const c = splitCells(l);
      return c.length >= 4 && nameKey(c[0]) === key;
    });
    if (!line) continue;

    const cells = splitCells(line).map((c) => c.trim());
    const bounds = cells.map((c, i) => (i > 0 && LONE_BOUND.test(c) ? i : -1)).filter((i) => i > 0);
    if (bounds.length !== 1) continue; // เกณฑ์สองฝั่ง ("99.0 | Min | 99.9 | Max | 99.5") = เดาไม่ออกว่าช่องไหนคือผล

    const i = bounds[0];
    const bound = numAt(cells[i - 1]);
    const value = numAt(cells[i + 1]);
    if (bound == null || value == null) continue;
    // ค่าผลต้องเป็นเลขตัวท้ายของบรรทัด ไม่งั้นที่หยิบมาคือช่องกลางตาราง ไม่ใช่คอลัมน์ผล
    if (cells.slice(i + 2).some((c) => numAt(c) != null)) continue;

    // เกณฑ์สองฝั่งที่ LLM อ่านมาถูกแล้ว ห้ามทับด้วยขอบเดียว — โมดูลนี้เข้ามาเพราะ "ค่าผล" เสีย ไม่ใช่เกณฑ์เสีย
    const spec = `${cells[i - 1]} ${cells[i]}`;
    const keepSpec = it.specMin != null && it.specMax != null;
    if (!keepSpec) {
      it.specRaw = spec;
      it.specMin = null;
      it.specMax = null;
    }
    it.result = value;
    fixed.push({ name: String(it.name), spec: keepSpec ? String(it.specRaw ?? spec) : spec, result: value });
  }

  return { fixed };
}
