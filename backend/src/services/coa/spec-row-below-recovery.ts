// ใบแนวนอนที่วางแถว "Specifications" ไว้ใต้แถวค่า และเกณฑ์มีน้อยกว่าคอลัมน์ (Yamaishi Tin Powder: D10 ไม่มีเกณฑ์)
//   LLM ออกแถวไม่ได้เลยทั้งใบ — จับคู่เองโดยยึดขวา (เกณฑ์ที่ขาดคือคอลัมน์ซ้ายสุด)
import { RawCoaItem } from "./ollama-coa.service";
import { splitCells } from "./column-shift-recovery";
import { normalizeSpec } from "./spec-normalizer";
import { NUM_PATTERN, toNum } from "./numeric";

const SPEC_HEAD = /^(specifications?|spec\.?|規格値?)$/i;
const LONE_NUM = new RegExp(`^(${NUM_PATTERN})\\s*%?$`);

export interface SpecRowBelowResult {
  items: RawCoaItem[];
  labels: number;
}

function asNumber(cell: string): number | null {
  const t = cell.replace(/(\d)\.\s+(\d)/g, "$1.$2").trim().replace(/\s*%$/, "");
  if (!LONE_NUM.test(t)) return null;
  const n = toNum(t);
  return Number.isFinite(n) ? n : null;
}

// ชื่อคอลัมน์ = ช่องที่ไม่ใช่ตัวเลขและสั้น (D10 / D50 / 50%) — ยาวเกินนี้คือประโยคในหัวตาราง ไม่ใช่ป้ายคอลัมน์
function labelCells(line: string): string[] | null {
  const cells = splitCells(line).map((c) => c.trim());
  if (cells.length < 2) return null;
  if (cells.some((c) => !c || c.length > 12 || asNumber(c) != null)) return null;
  return cells;
}

export function recoverSpecRowBelow(text: string): SpecRowBelowResult | null {
  if (!text) return null;
  const lines = text.split("\n");

  const specIdx = lines.findIndex((l) => {
    const c = splitCells(l).map((x) => x.trim());
    return c.length >= 3 && SPEC_HEAD.test(c[0]);
  });
  if (specIdx < 1) return null;

  const specs = splitCells(lines[specIdx])
    .slice(1)
    .map((c) => c.trim())
    .filter(Boolean);
  if (specs.length < 2 || specs.some((s) => !normalizeSpec(s))) return null;

  // ★ ต้องติดกัน 3 บรรทัด: ป้ายคอลัมน์ / ค่า / เกณฑ์ ★ เดินขึ้นไปไกลกว่านี้จะไปคว้าบรรทัด date/phone
  //   มาเป็นแถวค่า แล้วจับคู่เกณฑ์ผิดรายการโดยที่จำนวนช่องยังเท่ากันพอดี
  const valIdx = specIdx - 1;
  const values = splitCells(lines[valIdx] ?? "")
    .map((c) => asNumber(c.trim()))
    .filter((n): n is number => n != null);
  if (valIdx < 1 || values.length < specs.length) return null;

  // ป้ายคอลัมน์อยู่เหนือแถวค่า และต้องมีไม่น้อยกว่าจำนวนเกณฑ์ (เกณฑ์ที่ขาด = คอลัมน์ซ้ายที่ใบไม่ได้กำหนด)
  const labels = labelCells(lines[valIdx - 1] ?? "");
  if (!labels || labels.length < specs.length || values.length < labels.length) return null;

  // ยึดขวาทั้งสองฝั่ง: ค่า = เลขท้ายบรรทัดเท่าจำนวนป้าย · เกณฑ์ = ป้ายท้ายเท่าจำนวนเกณฑ์
  const aligned = values.slice(values.length - labels.length);
  const offset = labels.length - specs.length;

  const items: RawCoaItem[] = [];
  for (let i = 0; i < labels.length; i++) {
    const spec = i >= offset ? specs[i - offset] : null;
    const result = aligned[i];
    // เกณฑ์ที่จับคู่แล้วขัดกับค่า = อ่านตำแหน่งผิด ไม่ใช่ของเสีย → ถอยทั้งใบ ห้ามลองสลับให้เข้าเกณฑ์
    if (spec) {
      const parsed = normalizeSpec(spec)!;
      const lo = parsed.min ?? (parsed.op === "ge" || parsed.op === "gt" ? parsed.value : null);
      const hi = parsed.max ?? (parsed.op === "le" || parsed.op === "lt" ? parsed.value : null);
      if ((lo != null && result < lo) || (hi != null && result > hi)) return null;
    }
    items.push({ name: labels[i], specRaw: spec, result, specFromCell: spec ? true : undefined });
  }

  return { items, labels: labels.length };
}
