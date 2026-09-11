// ★ Result-side Min|Max recovery ★ — ใบไม่มี result เดี่ยว (เคย RB220) ผล+เกณฑ์แตกเป็น Min|Max — qwen3:4b พลาดทุกรัน
//   จึงกู้แบบ deterministic จาก header แทน (ตรวจย้อนได้ ไม่ drift) — ผลเป็น "ช่วง" ต้องอยู่ในกรอบ spec ทั้งช่วง
// ABSTAIN-BY-DEFAULT: ต้องเจอ header Results...Limits + sub-header Min./Max. ≥3 ช่อง + data ครบ ถึงแตะ item
import { RawCoaItem } from "./ollama-coa.service";

export interface MinMaxOverride {
  name: string;
  resultMin: string;
  resultMax: string;
  specMin: string | null;
  specMax: string | null;
}

export interface ResultMinMaxResult {
  overridden: MinMaxOverride[];
}

// block ที่อ่านได้จาก header — ยังไม่ผูกกับ item ของ LLM
interface MinMaxBlock {
  label: string; // ชื่อรายการจาก group-header line ("Fibre length", "Shotcontent")
  resultMin: string;
  resultMax: string;
  specMin: string | null;
  specMax: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const cellsOf = (line: string) => line.split("|").map((c) => c.trim());
const isNumericCell = (c: string) => /^-?\d+(?:[.,]\d+)*$/.test(c);
const isMinMaxCell = (c: string) => /^(min|max)\.?$/i.test(c);
const dirOf = (c: string): "min" | "max" => (/^min/i.test(c) ? "min" : "max");

// ชื่อรายการใน group-header line = cell ที่อยู่ซ้ายของ "Results" และไม่ใช่ Batch/Lot/No.
function labelFrom(cells: string[], resultsIdx: number): string | null {
  for (let i = resultsIdx - 1; i >= 0; i--) {
    const c = cells[i];
    if (!c || /^(batch|lot|item|no|test)\b/i.test(c) || isNumericCell(c)) continue;
    if (c.replace(/[^a-z0-9]/gi, "").length >= 3) return c;
  }
  return null;
}

// สแกน text หา block ที่เข้าโครง "Results Min|Max + Limits Min|Max" (ดู ABSTAIN ด้านบน)
function findBlocks(text: string): MinMaxBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: MinMaxBlock[] = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const cells = cellsOf(lines[i]);
    if (cells.length < 3) continue;
    const ri = cells.findIndex((c) => /^results?\b/i.test(c));
    const li = cells.findIndex((c) => /^(limits?|specifications?|spec)\b/i.test(c));
    if (ri < 0 || li < 0 || ri >= li) continue;

    // ชั้น 2 — sub-header Min./Max. ล้วน (≥3 ช่อง) และ 2 ช่องแรกเป็น Min,Max = ฝั่ง result
    const sub = cellsOf(lines[i + 1]).filter((c) => c.length > 0);
    if (sub.length < 3 || !sub.every(isMinMaxCell)) continue;
    if (dirOf(sub[0]) !== "min" || dirOf(sub[1]) !== "max") continue;

    // ชั้น 3 — data line ถัดไป (ภายใน 3 บรรทัด) ที่มี cell ตัวเลขล้วนพอกับจำนวน sub-header
    let nums: string[] | null = null;
    for (let k = i + 2; k < Math.min(i + 5, lines.length); k++) {
      const numeric = cellsOf(lines[k]).filter(isNumericCell);
      if (numeric.length >= sub.length) {
        nums = numeric.slice(-sub.length); // align ขวา — ตัด batch no./เลขในชื่อแถวทิ้งเอง
        break;
      }
    }
    if (!nums) continue;

    const label = labelFrom(cells, ri);
    if (!label) continue;

    // ฝั่งเกณฑ์ = sub-header ตั้งแต่ช่องที่ 3 (2 ช่องแรกเป็นของฝั่งผล)
    let specMin: string | null = null;
    let specMax: string | null = null;
    for (let s = 2; s < sub.length; s++) {
      if (dirOf(sub[s]) === "min") specMin = nums[s];
      else specMax = nums[s];
    }
    if (specMin == null && specMax == null) continue;

    blocks.push({ label, resultMin: nums[0], resultMax: nums[1], specMin, specMax });
  }
  return blocks;
}

// ★ override item ที่ชื่อตรงกับ block ★ — mutate in place, คืนรายการที่แก้
//   ล้าง result/specRaw ที่ LLM ให้มา (เคสนี้ LLM map ผิดเสมอ: result=ขอบล่าง, specRaw=ขอบบนของผล)
//   ไม่เจอ item ที่ชื่อตรง → ไม่เพิ่มแถวใหม่ (abstain — อย่าปั้นแถวจาก header อย่างเดียว)
export function recoverResultMinMax(
  items: RawCoaItem[],
  text: string
): ResultMinMaxResult {
  const overridden: MinMaxOverride[] = [];
  if (!items?.length || !text) return { overridden };

  const blocks = findBlocks(text);
  if (!blocks.length) return { overridden };

  for (const b of blocks) {
    const key = norm(b.label);
    const item = items.find((it) => {
      const n = norm(it.name ?? "");
      return n.length >= 3 && (n === key || n.includes(key) || key.includes(n));
    });
    if (!item) continue;

    item.resultMin = b.resultMin;
    item.resultMax = b.resultMax;
    item.result = null;
    item.specRaw = null;
    item.specMin = b.specMin;
    item.specMax = b.specMax;
    overridden.push({
      name: (item.name ?? b.label).trim(),
      resultMin: b.resultMin,
      resultMax: b.resultMax,
      specMin: b.specMin,
      specMax: b.specMax,
    });
  }
  return { overridden };
}
