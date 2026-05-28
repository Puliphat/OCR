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

  return {
    ...base,
    min,
    max,
    result: r,
    status: pass ? "PASS" : "FAIL",
    reason: pass ? "" : `result ${r} outside spec ${spec.raw}`,
  };
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

// Evaluate ทั้งใบ — loop เรียก evaluateItem แล้วรวม summary
export function evaluateCoa(input: CoaInput): CoaReport {
  const rows = (input.items ?? []).map(evaluateItem);
  const summary = rows.reduce(
    (acc, r) => {
      acc.total++;
      if (r.status === "PASS") acc.pass++;
      else if (r.status === "FAIL") acc.fail++;
      else acc.skip++;
      return acc;
    },
    { pass: 0, fail: 0, skip: 0, total: 0 }
  );
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
        r.reason,
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
