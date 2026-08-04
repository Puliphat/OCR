// แปลง result จาก LLM → number ตัวเดียวสำหรับเทียบ spec
// รับได้ทั้ง number / string / object {avg,min,max,raw} — ใช้ avg เป็นหลัก
import { NUM_PATTERN, toNum } from "./numeric";

export interface ResultValues {
  avg?: number;
  min?: number;
  max?: number;
  stdev?: number;
  raw?: string;
}

export interface NormalizedResult {
  value: number;
  source: "avg" | "single" | "all_values" | "interval";
  values?: number[];
  raw: string;
  bound?: { op: "lt" | "le" | "gt" | "ge"; value: number };
  // ★ result เป็น "ช่วงที่วัดได้" (คอลัมน์ Min + Max แยกกัน ไม่มีคอลัมน์ result เดี่ยว — เคส RB220) ★
  //   ต้องอยู่ในกรอบ spec ทั้งช่วง ไม่ใช่จุดเดียว → evaluator เทียบ 2 ขอบ (ดู evaluateInterval)
  interval?: { min: number; max: number };
}

const NUM_RE = new RegExp(NUM_PATTERN, "g");
// result แบบ bound ล้วน: "<15", "≤0.01", "≥ 95" — ทั้ง string ต้องเป็น comparator + เลข (ไม่มี unit ต่อท้าย)
const BOUND_RE = new RegExp(String.raw`^\s*(<=|≤|≦|<|>=|≥|≧|>)\s*(${NUM_PATTERN})\s*$`);

function extractNumbers(s: string): number[] {
  const matches = String(s).match(NUM_RE);
  return matches ? matches.map(toNum).filter((n) => !Number.isNaN(n)) : [];
}

// คืน null = ไม่ใช่ตัวเลข (evaluator จะตี SKIP ไม่ใช่ FAIL)
// reject ค่าที่ไม่ขึ้นต้นด้วยตัวเลข/+/-/. เช่น "White", "K2Ti6O13", "Pass"
export function normalizeResult(raw: unknown): NormalizedResult | null {
  if (raw == null) return null;

  if (typeof raw === "number" && !Number.isNaN(raw)) {
    return { value: raw, source: "single", raw: String(raw) };
  }

  if (typeof raw === "object") {
    const r = raw as ResultValues;
    if (typeof r.avg === "number" && !Number.isNaN(r.avg)) {
      return { value: r.avg, source: "avg", raw: r.raw ?? String(r.avg) };
    }
    // ★ interval ★ — min + max ครบคู่ ไม่มี avg = ค่าที่วัดได้เป็น "ช่วง" (RB220: Results Min/Max 2 คอลัมน์)
    //   ★ ห้ามเฉลี่ย ★ — ค่าเฉลี่ยของขอบช่วงไม่มีความหมาย และซ่อนขอบที่หลุด spec ได้ = deceptive PASS
    //   (result [0.4,0.6] vs spec ≤0.5 → avg 0.5 ผ่านทั้งที่ max หลุด). ช่วงยุบ (min==max) → เป็นจุดเดียวปกติ
    if (
      typeof r.min === "number" && !Number.isNaN(r.min) &&
      typeof r.max === "number" && !Number.isNaN(r.max)
    ) {
      const lo = Math.min(r.min, r.max);
      const hi = Math.max(r.min, r.max);
      const raw2 = r.raw ?? (lo === hi ? String(lo) : `${r.min} – ${r.max}`);
      if (lo === hi) return { value: lo, source: "single", raw: raw2 };
      return {
        value: lo,
        source: "interval",
        values: [lo, hi],
        raw: raw2,
        interval: { min: lo, max: hi },
      };
    }
    const nums = [r.avg, r.min, r.max].filter(
      (n) => typeof n === "number" && !Number.isNaN(n)
    ) as number[];
    if (nums.length > 0) {
      return {
        value: nums.reduce((a, b) => a + b, 0) / nums.length,
        source: "all_values",
        values: nums,
        raw: r.raw ?? nums.join(","),
      };
    }
    return null;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // result แบบ bound: "<15", "≤0.01", "≦ 0.2", ">50", "≥ 95"
  // ทั้ง string ต้องเป็น comparator + เลข เท่านั้น (ไม่มี unit ต่อท้าย — เข้มงวด)
  {
    const m = s.match(BOUND_RE);
    const num = m ? toNum(m[2]) : NaN;
    // NaN = ตัวคั่นหลายกลุ่มที่อ่านไม่ออก (OCR ต่อเลขติดกัน) → ตกไป path ปกติ ไม่ปั้น bound จากค่าเสีย
    if (m && Number.isFinite(num)) {
      const sym = m[1];
      const op: "lt" | "le" | "gt" | "ge" =
        sym === "<" ? "lt" :
        sym === "<=" || sym === "≤" || sym === "≦" ? "le" :
        sym === ">" ? "gt" : "ge";
      return { value: num, source: "single", raw: s, bound: { op, value: num } };
    }
  }

  // ปัดค่าที่เป็นข้อความ (สูตรเคมี, "White", "GOOD", "Pass", "Light Yellow"...)
  // result ตัวเลขจริงต้องขึ้นต้นด้วย digit, เครื่องหมาย, หรือจุดทศนิยม
  if (!/^[\-+.\d]/.test(s)) return null;

  const nums = extractNumbers(s);
  if (nums.length === 0) return null;
  if (nums.length === 1) {
    return { value: nums[0], source: "single", raw: s };
  }
  return {
    value: nums.reduce((a, b) => a + b, 0) / nums.length,
    source: "all_values",
    values: nums,
    raw: s,
  };
}
