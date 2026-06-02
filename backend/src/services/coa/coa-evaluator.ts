// Deterministic evaluator — รับ JSON จาก LLM แล้วตัด PASS/FAIL/SKIP ต่อ row
// Logic ไม่พึ่ง LLM เลย เปลี่ยน rule ที่นี่ได้โดยไม่ต้อง re-run pipeline
import { ParsedSpec, normalizeSpecFromCandidate } from "./spec-normalizer";
import { normalizeResult, ResultValues } from "./result-normalizer";

export type Status = "PASS" | "FAIL" | "SKIP";

export interface CoaItemInput {
  name?: string | null;
  unit?: string | null;
  method?: string | null;
  specRaw?: string | null;
  specMin?: string | number | null;
  specMax?: string | number | null;
  result?: string | number | ResultValues | null;
}

export interface EvaluatedItem {
  name: string;
  unit: string | null;
  method: string | null;
  min: number | null;
  max: number | null;
  result: number | null;
  status: Status;
  reason: string;
  specRaw: string | null;
  resultRaw: string | null;
  needsReview: boolean; // ธงเตือนคน: ค่าน่าสงสัยว่า OCR ทศนิยมหาย (ไม่เปลี่ยน PASS/FAIL)
}

// Evaluate 1 row: parse spec + result → เทียบตาม op (between/le/ge/lt/gt/eq)
// spec อ่านไม่ออก → SKIP "spec not parseable", result ไม่ใช่ตัวเลข → SKIP "result not numeric"
export function evaluateItem(item: CoaItemInput): EvaluatedItem {
  const name = (item.name ?? "").trim() || "(unknown)";
  const unit = item.unit?.toString().trim() || null;
  const method = item.method?.toString().trim() || null;

  const spec = normalizeSpecFromCandidate({
    specRaw: item.specRaw,
    min: item.specMin,
    max: item.specMax,
  });
  const result = normalizeResult(item.result);

  const base = {
    name,
    unit,
    method,
    specRaw: spec?.raw ?? (item.specRaw ?? null),
    resultRaw: result?.raw ?? (item.result == null ? null : String(item.result)),
  };

  if (!spec) {
    return {
      ...base,
      min: null,
      max: null,
      result: result?.value ?? null,
      status: "SKIP",
      reason: "spec not parseable (text/formula/empty)",
      needsReview: false,
    };
  }

  if (!result) {
    return {
      ...base,
      min: spec.min ?? null,
      max: spec.max ?? null,
      result: null,
      status: "SKIP",
      reason: "result not numeric",
      needsReview: false,
    };
  }

  const { value: r } = result;
  let pass = false;
  let min: number | null = null;
  let max: number | null = null;

  switch (spec.op) {
    case "between":
      min = spec.min!;
      max = spec.max!;
      pass = r >= min && r <= max;
      break;
    case "le":
      max = spec.value!;
      pass = r <= max;
      break;
    case "lt":
      max = spec.value!;
      pass = r < max;
      break;
    case "ge":
      min = spec.value!;
      pass = r >= min;
      break;
    case "gt":
      min = spec.value!;
      pass = r > min;
      break;
    case "eq":
      pass = r === spec.value;
      min = spec.value!;
      max = spec.value!;
      break;
    case "approx":
      pass = r === spec.value;
      break;
  }

  // ★ Anti-fabricated-PASS guard ★ — โมเดลเล็กบางตัว (เห็นใน qwen2.5) เวลาเจอตารางคอลัมน์แยก
  //   "Spec | Result" จะเอา "ค่าผล" ไปแปะเป็นขอบช่วง spec (เช่น spec=80.0, result=69.11 → "69.11~80.0")
  //   ทำให้ result ตกในช่วงของตัวเองเสมอ → PASS ปลอม 100% ซึ่งซ่อนของที่อาจ OOS = บาปหนักสุดของ QA
  // สัญญาณ: spec เป็น between แล้ว result ตรงกับขอบเป๊ะ → ดาวน์เกรดเป็น SKIP ให้คนตรวจ
  // ปลอดภัย: เคสนี้เป็น would-be-PASS เท่านั้น (FAIL จริง result อยู่นอกช่วง ไม่มีทาง == ขอบ) → ไม่ซ่อน FAIL
  if (pass && spec.op === "between" && (r === spec.min || r === spec.max)) {
    return {
      ...base,
      min,
      max,
      result: r,
      status: "SKIP",
      reason: "ขอบช่วง spec = ค่าผลพอดี — อาจเป็น spec ปลอม (โมเดลเอาค่าผลมาเป็นขอบ) ตรวจใบจริง",
      needsReview: true,
    };
  }

  const review = detectDecimalRisk(r, spec, pass);
  const reason = pass
    ? review ?? ""
    : `result ${r} outside spec ${spec.raw}` + (review ? ` — ${review}` : "");

  return {
    ...base,
    min,
    max,
    result: r,
    status: pass ? "PASS" : "FAIL",
    reason,
    needsReview: !!review,
  };
}

// ตรวจความเสี่ยง "OCR ทศนิยมหาย" — ★ ไม่เปลี่ยน PASS/FAIL ★ แค่ตั้งธงให้คนตรวจใบจริง
//  - FAIL: ถ้าเติมทศนิยมแล้วเข้า spec (423→42.3 ใน 15-45) = น่าจะ OCR พลาด ไม่ใช่ของเสียจริง
//  - PASS: ถ้า spec เป็น lower-bound (≥/Min) แล้วค่าจริงอาจตก (≥10 ได้ 13 แต่จริง 1.3) = ผ่านแบบอันตราย
function specContains(spec: ParsedSpec, v: number): boolean {
  switch (spec.op) {
    case "between":
      return v >= (spec.min ?? -Infinity) && v <= (spec.max ?? Infinity);
    case "le":
      return v <= (spec.value ?? Infinity);
    case "lt":
      return v < (spec.value ?? Infinity);
    case "ge":
      return v >= (spec.value ?? -Infinity);
    case "gt":
      return v > (spec.value ?? -Infinity);
    case "eq":
    case "approx":
      return v === spec.value;
    default:
      return false;
  }
}

function detectDecimalRisk(
  r: number,
  spec: ParsedSpec,
  pass: boolean
): string | null {
  if (!Number.isInteger(r) || r === 0) return null;
  const alts = [r / 10, r / 100];
  if (!pass) {
    for (const a of alts) {
      if (specContains(spec, a))
        return `อาจเป็น OCR ทศนิยมหาย (${r}→${a} เข้า spec) ตรวจใบจริง`;
    }
    return null;
  }
  // pass: flag เฉพาะ spec แบบ lower-bound (กัน false alarm บนค่าที่ถูกต้องอยู่แล้ว เช่น 56 ใน 45-75)
  if (spec.op === "ge" || spec.op === "gt") {
    for (const a of alts) {
      if (!specContains(spec, a))
        return `ผ่านแบบเสี่ยง: ถ้าจริงคือ ${a} (ทศนิยมหาย) จะตก spec`;
    }
  }
  return null;
}

export interface CoaInput {
  filename: string;
  product?: string | null;
  lotNo?: string | null;
  items: CoaItemInput[];
}

export interface CoaReport {
  filename: string;
  product: string | null;
  lotNo: string | null;
  rows: EvaluatedItem[];
  summary: { pass: number; fail: number; skip: number; total: number };
}

// รวม summary จาก rows — แยกออกมาเพื่อให้ post-eval guard (fail-guard) เรียกซ้ำหลังแก้ status ได้
export function summarize(rows: EvaluatedItem[]): CoaReport["summary"] {
  return rows.reduce(
    (acc, r) => {
      acc.total++;
      if (r.status === "PASS") acc.pass++;
      else if (r.status === "FAIL") acc.fail++;
      else acc.skip++;
      return acc;
    },
    { pass: 0, fail: 0, skip: 0, total: 0 }
  );
}

// Evaluate ทั้งใบ — loop เรียก evaluateItem แล้วรวม summary
export function evaluateCoa(input: CoaInput): CoaReport {
  const rows = (input.items ?? []).map(evaluateItem);
  const summary = summarize(rows);
  return {
    filename: input.filename,
    product: input.product?.trim() || null,
    lotNo: input.lotNo?.trim() || null,
    rows,
    summary,
  };
}

// Pretty-print แบบ ASCII table — ใช้กับ CLI (test-coa.ts) เท่านั้น (HTTP คืน JSON)
export function formatReport(report: CoaReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(110));
  lines.push(`FILE   : ${report.filename}`);
  if (report.product) lines.push(`PRODUCT: ${report.product}`);
  if (report.lotNo) lines.push(`LOT    : ${report.lotNo}`);
  lines.push("-".repeat(110));

  const header = [
    pad("Item", 36),
    pad("Min", 10),
    pad("Max", 10),
    pad("Result", 10),
    pad("Unit", 8),
    pad("Status", 6),
    "Note",
  ].join("  ");
  lines.push(header);
  lines.push("-".repeat(110));

  for (const r of report.rows) {
    lines.push(
      [
        pad(trunc(r.name, 36), 36),
        pad(fmtNum(r.min), 10),
        pad(fmtNum(r.max), 10),
        pad(fmtNum(r.result), 10),
        pad(trunc(r.unit ?? "", 8), 8),
        pad(r.status, 6),
        (r.needsReview ? "⚠ " : "") + r.reason,
      ].join("  ")
    );
  }
  lines.push("-".repeat(110));
  lines.push(
    `SUMMARY: ${report.summary.pass} PASS, ${report.summary.fail} FAIL, ${report.summary.skip} SKIP (of ${report.summary.total})`
  );
  return lines.join("\n");
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}
function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}
