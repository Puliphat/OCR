// แปลง result จาก LLM → number ตัวเดียวสำหรับเทียบ spec
// รับได้ทั้ง number / string / object {avg,min,max,raw} — ใช้ avg เป็นหลัก
export interface ResultValues {
  avg?: number;
  min?: number;
  max?: number;
  stdev?: number;
  raw?: string;
}

export interface NormalizedResult {
  value: number;
  source: "avg" | "single" | "all_values";
  values?: number[];
  raw: string;
}

const NUM_RE = /-?\d+(?:[.,]\d+)?/g;

function toNum(s: string): number {
  return Number(s.replace(/,/g, ""));
}

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

  // Reject text-like values (chemical formulas, "White", "GOOD", "Pass", "Light Yellow"...).
  // A real numeric result starts with a digit, sign, or decimal point.
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
