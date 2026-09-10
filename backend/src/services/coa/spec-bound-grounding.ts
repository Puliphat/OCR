// ขอบเกณฑ์ที่ไม่ได้อยู่ในบรรทัดของแถวตัวเอง = ค่าที่ยืมมาจากแถวอื่น (HG-PP: LLM ข้ามช่องว่าง
//   ของ Fe แล้วหยิบ 46.0 ของแถว S มาเป็นขอบบน) — ตัดทิ้งเหลือขอบที่พิสูจน์ได้ ไม่แตะค่าผล
import { RawCoaItem } from "./ollama-coa.service";
import { normalizeSpecFromCandidate } from "./spec-normalizer";
import { splitCells } from "./column-shift-recovery";

export interface SpecBoundResult {
  fixed: { name: string; from: string; to: string }[];
}

// ช่องที่ใบเขียนว่า "ไม่มีเกณฑ์ด้านนี้" — OCR อ่านขีดเป็นคันจิ 一 / คาตาคานะ ー ได้บ่อยบนใบญี่ปุ่น
const EMPTY_CELL = /^[-–—一ー_]+$/;

// นับเฉพาะช่องที่เป็นตัวเลขล้วน — ถ้า regex ทั้งบรรทัด เลขในชื่อสาร (SiO2 → 2) จะถูกนับเป็นเกณฑ์
function numsIn(cells: string[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    const t = c.replace(/\s+/g, "").replace(/%$/, "");
    if (/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) out.push(Number(t.replace(/,/g, ".")));
  }
  return out;
}

function nameSig(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /\d/.test(t));
}

// บรรทัดเดียวที่เป็นของแถวนี้จริง — เจอหลายบรรทัดหรือไม่เจอเลย = พิสูจน์ไม่ได้ ปล่อยไว้
function anchorLine(name: string, lines: string[]): string | null {
  const sig = nameSig(name);
  if (sig.length < 1) return null;
  const need = Math.max(1, Math.ceil(sig.length * 0.6));
  const hits = lines.filter((l) => {
    const ls = nameSig(l);
    return sig.filter((t) => ls.includes(t)).length >= need;
  });
  return hits.length === 1 ? hits[0] : null;
}

// mutate items in place — คืนรายการแถวที่ตัดขอบทิ้ง
export function dropUngroundedSpecBounds(
  items: RawCoaItem[],
  ocrText: string
): SpecBoundResult {
  const fixed: SpecBoundResult["fixed"] = [];
  if (!items?.length || !ocrText) return { fixed };
  const lines = ocrText.split(/\r?\n/);

  for (const it of items) {
    // เกณฑ์ที่โมดูล structural นับช่องแล้วอ่านมาจากช่องของแถวตัวเอง — ที่มาแน่นกว่าการไล่หาบรรทัดจาก
    //   flat text ตรงนี้ ตัดขอบทิ้งเมื่อไรคือทำเกณฑ์ให้หลวมกว่าใบจริงด้วยหลักฐานที่อ่อนกว่า
    if (it.specFromCell === true) continue;

    const spec = normalizeSpecFromCandidate({
      specRaw: it.specRaw,
      min: it.specMin,
      max: it.specMax,
    });
    if (!spec || spec.op !== "between" || spec.min == null || spec.max == null) continue;

    const line = anchorLine(it.name ?? "", lines);
    if (!line) continue;
    const cells = splitCells(line);
    // ★ ต้องเห็นช่องว่างบนใบก่อนถึงจะตัด ★ — ไม่มีช่องว่าง = อาจเป็น OCR ที่อ่านขอบไม่ครบ
    //   ตัดทิ้งตอนนั้นจะกลายเป็นเกณฑ์ด้านเดียวที่หลวมกว่าใบจริง = เสี่ยงปล่อยค่าเกินให้ผ่าน
    if (!cells.some((c) => EMPTY_CELL.test(c.trim()))) continue;

    const nums = numsIn(cells);
    const has = (v: number) => nums.some((n) => Math.abs(n - v) < 1e-9);
    const minIn = has(spec.min);
    const maxIn = has(spec.max);
    if (minIn === maxIn) continue; // อยู่ทั้งคู่ = ถูกแล้ว · ไม่อยู่ทั้งคู่ = คนละบรรทัด ตัดสินไม่ได้

    const before = spec.raw;
    const kept = minIn ? `${spec.min} Min.` : `${spec.max} Max.`;
    it.specRaw = kept;
    it.specMin = null;
    it.specMax = null;
    fixed.push({ name: (it.name ?? "(unknown)").trim(), from: before, to: kept });
  }
  return { fixed };
}
