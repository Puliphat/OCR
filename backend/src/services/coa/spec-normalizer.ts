// ★ แก้บ่อยที่สุด ★ — แปลง spec string จากใบ COA → {op, min/max/value}
// เจอ format ใหม่ที่ไม่เข้า? เพิ่ม branch ใน normalizeSpec + เพิ่ม fixture ที่ evaluator.test.ts
export type SpecOp =
  | "between"
  | "le"
  | "ge"
  | "lt"
  | "gt"
  | "eq"
  | "approx";

export interface ParsedSpec {
  op: SpecOp;
  min?: number;
  max?: number;
  value?: number;
  raw: string;
}

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;

// คำตัดสิน/ผลรวมท้าย cell ที่ LLM เล็กชอบลากมาปนใน specRaw (เช่น "20 Max Success") →
// regex spec anchored ที่ $ จึง match ไม่ได้ → normalizeSpec คืน null → ตกไปใช้ bare specMin/Max
// (ทิศมั่ว = fabricated FAIL). ตัดทิ้งท้ายก่อน parse ให้ "20 Max Success" → "20 Max"
const JUDGMENT_TAIL =
  /\s*\b(success(?:ful)?|pass(?:ed)?|accept(?:ed|able)?|good|ok|qualified|conform(?:ed|ing)?|合格|ผ่าน)\b[\s.]*$/i;

// EU decimal vs US thousands: ถ้ามี comma แต่ไม่มี period → comma คือทศนิยม (0,28 → 0.28)
// ถ้ามีทั้ง 2 → comma คือ thousands ให้ strip ออก (1,000.5 → 1000.5)
function toNum(s: string): number {
  let cleaned = s.trim();
  if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  return Number(cleaned);
}

function stripUnits(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[%℃°]/g, "")
    .replace(/g\/cm3?|kg\/cm2?|g\/10\s*min|g\/l|m2\/g|μm|um|mm|ppm|cm|kg|wt|sec|min(?!\.)|\(m\/m\)/gi, "")
    .trim();
}

// Parse spec จากคอลัมน์เดียว (เช่น "275-425", "≤ 0.2", "26 ± 2")
// ลำดับ branch สำคัญ — ± ก่อน range เพราะ "26 ± 2" ก็เข้า regex range ได้
export function normalizeSpec(raw: unknown): ParsedSpec | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(/[～〜∼]/g, "~");
  s = s.replace(JUDGMENT_TAIL, "").trim(); // ตัด "Success/Pass/ผ่าน" ท้ายที่ LLM ลากปนมา
  if (!s) return null;

  const original = s;
  const cleaned = stripUnits(s);

  // ± tolerance:  "26.0 ± 2.0",  "7 ± 3",  "120 +/- 30"
  {
    const m = cleaned.match(
      new RegExp(`^(${NUM})\\s*(?:±|\\+/-|\\+-)\\s*(${NUM})$`)
    );
    if (m) {
      const center = toNum(m[1]);
      const tol = toNum(m[2]);
      return {
        op: "between",
        min: center - tol,
        max: center + tol,
        raw: original,
      };
    }
  }

  // Range: "275-425", "0.6~0.8", "40.0 ~ 70.0", "105〜115"
  {
    const m = cleaned.match(
      new RegExp(`^(${NUM})\\s*(?:[~\\-–—]\\s*)+(${NUM})$`)
    );
    if (m) {
      const a = toNum(m[1]);
      const b = toNum(m[2]);
      return {
        op: "between",
        min: Math.min(a, b),
        max: Math.max(a, b),
        raw: original,
      };
    }
  }

  // ≤ / ≦ / <= / Max.
  {
    const leSym = cleaned.match(new RegExp(`^(?:≤|≦|<=)\\s*(${NUM})$`));
    const leSuffix = cleaned.match(new RegExp(`^(${NUM})\\s*Max\\.?$`, "i"));
    const m = leSym || leSuffix;
    if (m) return { op: "le", value: toNum(m[1]), raw: original };
  }

  // ≥ / ≧ / >= / Min.
  {
    const geSym = cleaned.match(new RegExp(`^(?:≥|≧|>=)\\s*(${NUM})$`));
    const geSuffix = cleaned.match(new RegExp(`^(${NUM})\\s*Min\\.?$`, "i"));
    const m = geSym || geSuffix;
    if (m) return { op: "ge", value: toNum(m[1]), raw: original };
  }

  // strict <
  {
    const m = cleaned.match(new RegExp(`^<\\s*(${NUM})$`));
    if (m) return { op: "lt", value: toNum(m[1]), raw: original };
  }

  // strict >
  {
    const m = cleaned.match(new RegExp(`^>\\s*(${NUM})$`));
    if (m) return { op: "gt", value: toNum(m[1]), raw: original };
  }

  // bare number -> equal
  {
    const m = cleaned.match(new RegExp(`^(${NUM})$`));
    if (m) return { op: "eq", value: toNum(m[1]), raw: original };
  }

  return null;
}

export interface SpecCandidate {
  specRaw?: string | null;
  min?: string | number | null;
  max?: string | number | null;
}

// รองรับกรณีตารางแยกคอลัมน์ Min/Max (LLM แยกใส่ specMin/specMax ให้)
// ทั้ง min+max → between, มีอย่างเดียว → ge/le, ไม่มี → fallback ใช้ specRaw
export function normalizeSpecFromCandidate(c: SpecCandidate): ParsedSpec | null {
  // ★ specRaw (verbatim 1 cell) ที่มี operator/range ชัด = น่าเชื่อสุด — เช็คก่อน min/max ★
  //   LLM เล็กชอบใส่ทั้ง specRaw="0.01 Max." (ถูก) + specMin="0.01" (bare) พร้อมกัน → ถ้าเช็ค min ก่อน
  //   bare specMin บังให้เป็น ge → fabricated FAIL. specMin/specMax คือ "การตีความ column" ของ LLM
  //   (พลาดบ่อย) ส่วน specRaw คือ copy ตรง ๆ → ทิศใน specRaw ชนะเมื่อมันบอกทิศชัด (ไม่ใช่เลขเปล่า)
  if (c.specRaw != null && String(c.specRaw).trim() !== "") {
    const pr = normalizeSpec(c.specRaw);
    if (pr && pr.op !== "eq") return pr;
  }

  const minPresent = c.min !== null && c.min !== undefined && String(c.min).trim() !== "";
  const maxPresent = c.max !== null && c.max !== undefined && String(c.max).trim() !== "";

  if (minPresent && maxPresent) {
    const parsedMin = normalizeSpec(c.min);
    const parsedMax = normalizeSpec(c.max);
    if (parsedMin?.value != null && parsedMax?.value != null) {
      // LLM อาจ flip min/max — swap ถ้า min > max (real spec ไม่มีทาง min > max)
      const lo = Math.min(parsedMin.value, parsedMax.value);
      const hi = Math.max(parsedMin.value, parsedMax.value);
      return {
        op: "between",
        min: lo,
        max: hi,
        raw: `${c.min}~${c.max}`,
      };
    }
  }
  // single column: ถ้าค่ามี operator/range ของตัวเอง (≥ ≤ < > ± range) = self-describing → ใช้ตามนั้น
  //   กัน LLM ใส่ spec ผิดช่อง เช่น "≥ 50" ลง specMax แล้วถูกบังคับเป็น le → ผล PASS/FAIL กลับด้าน
  //   เฉพาะ bare number (op "eq") เท่านั้นที่ใช้ทิศตาม column: min col → ge, max col → le
  if (minPresent && !maxPresent) {
    const p = normalizeSpec(c.min);
    if (p) return p.op === "eq" ? { op: "ge", value: p.value, raw: String(c.min) } : p;
  }
  if (maxPresent && !minPresent) {
    const p = normalizeSpec(c.max);
    if (p) return p.op === "eq" ? { op: "le", value: p.value, raw: String(c.max) } : p;
  }
  if (c.specRaw) return normalizeSpec(c.specRaw);
  return null;
}
