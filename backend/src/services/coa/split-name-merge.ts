// ชื่อรายการที่ OCR ตัดเป็น 2 ช่องบนบรรทัดเดียว ("Bulk | Density(kg/1) | 0.34 | Spec | 0.30 ± 0.08")
//   ทำให้ LLM แตกเป็น 2 แถว แถวหลังเป็นแถวผีที่หยิบเลขจากเกณฑ์ของแถวแรกมาเป็นค่า — รวมชื่อคืนแล้วทิ้งแถวผี
import { RawCoaItem } from "./ollama-coa.service";
import { splitCells } from "./column-shift-recovery";
import { toNum } from "./numeric";

export interface SplitNameMergeResult {
  items: RawCoaItem[];
  merged: { kept: string; dropped: string }[];
}

function nameKey(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9µμ]/g, "");
}

function hasSpec(i: RawCoaItem): boolean {
  return (
    !!String(i.specRaw ?? "").trim() ||
    String(i.specMin ?? "").trim() !== "" ||
    String(i.specMax ?? "").trim() !== ""
  );
}

// เลขทุกตัวในข้อความ — ใช้ดูว่าค่าของแถวผีถูกใช้ไปแล้วในเกณฑ์ของแถวที่ชื่อถูกตัด
function numbersIn(s: unknown): number[] {
  const out: number[] = [];
  for (const m of String(s ?? "").matchAll(/-?\d+(?:[.,]\d+)?/g)) {
    const n = toNum(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function resultNumber(i: RawCoaItem): number | null {
  const r = i.result;
  if (r == null) return null;
  if (typeof r === "object") return null;
  const nums = numbersIn(r);
  return nums.length === 1 ? nums[0] : null;
}

// ชื่อสองช่องนี้ติดกันบนบรรทัดเดียวกันของ OCR ไหม (ลำดับต้องตรงกับที่ LLM ออกมา)
function adjacentOnSameLine(ocrText: string, first: string, second: string): boolean {
  const a = nameKey(first);
  const b = nameKey(second);
  if (!a || !b) return false;
  for (const line of ocrText.split(/\r?\n/)) {
    const cells = splitCells(line).map(nameKey);
    const idx = cells.indexOf(a);
    if (idx >= 0 && cells[idx + 1] === b) return true;
  }
  return false;
}

// รวมครึ่งหลังของชื่อกลับเข้าแถวก่อนหน้า แล้วตัดแถวผีทิ้ง — ต้องครบ 3 ข้อ: ชื่อติดกันบนบรรทัด OCR
//   เดียวกัน · แถวหลังไม่มีเกณฑ์เลย · ค่าของมันว่างหรือเป็นเลขที่นับไปแล้วในเกณฑ์ของแถวแรก
export function mergeSplitNameRows(items: RawCoaItem[], ocrText: string): SplitNameMergeResult {
  const merged: SplitNameMergeResult["merged"] = [];
  if (!items?.length || !ocrText) return { items, merged };

  const out: RawCoaItem[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    const canMerge =
      prev &&
      hasSpec(prev) &&
      !hasSpec(item) &&
      adjacentOnSameLine(ocrText, prev.name ?? "", item.name ?? "");
    if (!canMerge) {
      out.push(item);
      continue;
    }
    const own = resultNumber(item);
    const spent = [...numbersIn(prev.specRaw), ...numbersIn(prev.specMin), ...numbersIn(prev.specMax)];
    const carriesOwnValue = own !== null && !spent.some((n) => Math.abs(n - own) < 1e-9);
    if (carriesOwnValue) {
      out.push(item);
      continue;
    }
    merged.push({ kept: `${prev.name} ${item.name}`, dropped: String(item.name ?? "") });
    prev.name = `${prev.name} ${item.name}`.replace(/\s+/g, " ").trim();
  }
  return { items: out, merged };
}
