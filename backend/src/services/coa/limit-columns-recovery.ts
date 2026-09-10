// ใบที่หัวตารางเขียนเกณฑ์ไว้ "ก่อน" ค่าผล (Lower limit | Upper limit | Analysis Results — IMERYS NYGLOS)
//   LLM หยิบเลขตัวแรกเป็นค่าผลทุกแถว → เกณฑ์กับผลสลับกัน ออกมาเป็น FAIL ปลอมทั้งใบ
import { RawCoaItem } from "./ollama-coa.service";
import { splitCells } from "./column-shift-recovery";
import { NUM_PATTERN, toNum } from "./numeric";

export interface LimitColumnsResult {
  fixed: { name: string; from: string; to: string }[];
}

const LOWER_HEAD = /lower\s*limit|min\.?\s*limit|下限/i;
const UPPER_HEAD = /upper\s*limit|max\.?\s*limit|上限/i;
const RESULT_HEAD = /analysis|result|実測|測定値/i;

// หัวตารางต้องบอกครบว่ามีทั้งขอบล่าง ขอบบน และช่องผล และผลต้องอยู่ขวาสุดของสามช่องนี้
function headerLineIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!LOWER_HEAD.test(line) || !UPPER_HEAD.test(line)) continue;
    const lo = line.search(LOWER_HEAD);
    const up = line.search(UPPER_HEAD);
    const res = line.search(RESULT_HEAD);
    if (res > up && up > lo) return i;
  }
  return -1;
}

const NUM_RE = new RegExp(`^(${NUM_PATTERN})$`);

function nameKey(s: string): string {
  return s.toLowerCase().replace(/[\s()%]/g, "");
}

// หาบรรทัดของรายการนี้ในข้อความ OCR แล้วอ่านเลข 3 ตัวแรกเป็น ขอบล่าง|ขอบบน|ผล ตามลำดับหัวตาราง
export function recoverLimitColumns(items: RawCoaItem[], text: string): LimitColumnsResult {
  const fixed: LimitColumnsResult["fixed"] = [];
  if (!items.length || !text) return { fixed };

  const lines = text.split("\n");
  const headIdx = headerLineIndex(lines);
  if (headIdx < 0) return { fixed }; // ไม่ใช่ใบท่านี้ → ไม่แตะ

  for (const it of items) {
    const key = nameKey(String(it.name ?? ""));
    if (!key) continue;

    // ต้องเป็นบรรทัดที่อยู่ใต้หัวตารางเท่านั้น — บล็อกอื่นบนหน้าเดียวกันอาจเรียงคอลัมน์คนละแบบ
    const idx = lines.findIndex((l, i) => {
      if (i <= headIdx) return false;
      const cells = splitCells(l);
      return cells.length >= 2 && nameKey(cells[0]) === key;
    });
    if (idx < 0) continue;
    const line = lines[idx];

    const nums = splitCells(line)
      .slice(1)
      .map((c) => c.trim())
      .filter((c) => NUM_RE.test(c))
      .map(toNum)
      .filter((n) => Number.isFinite(n));
    if (nums.length !== 3) continue; // เกิน 3 = มีคอลัมน์ตัวเลขอื่นปน จับคู่ไม่ได้แน่นอน

    const [lo, hi, result] = nums;
    if (lo > hi) continue; // หัวตารางบอกว่าซ้ายคือขอบล่าง — ไม่เป็นตามนั้น = อ่านบรรทัดผิด

    // พิสูจน์ตัวเอง: บั๊กที่โมดูลนี้แก้คือ "LLM หยิบขอบล่างมาเป็นค่าผล" → ถ้าค่าเดิมไม่ใช่ขอบล่าง แปลว่าคนละอาการ
    const prev = Number(it.result);
    if (!Number.isFinite(prev) || Math.abs(prev - lo) > 1e-9) continue;

    const before = `${it.specMin ?? "-"}~${it.specMax ?? "-"} ผล ${it.result ?? "-"}`;
    it.specMin = lo;
    it.specMax = hi;
    it.specRaw = `${lo}~${hi}`;
    it.result = result;
    it.specFromCell = true;
    fixed.push({ name: String(it.name), from: before, to: `${lo}~${hi} ผล ${result}` });
  }

  return { fixed };
}
