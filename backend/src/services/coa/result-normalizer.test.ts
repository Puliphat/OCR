import { normalizeResult } from "./result-normalizer";
import { evaluateItem } from "./coa-evaluator";

let pass = 0, fail = 0;

function check(label: string, ok: boolean, extra?: string) {
  if (ok) { pass++; }
  else { fail++; console.log("FAIL", label, extra ?? ""); }
}

// ── Parsing tests ─────────────────────────────────────────────────────────────

{
  const r = normalizeResult("<15");
  check("<15 → bound lt 15",
    r !== null && r.bound?.op === "lt" && r.bound?.value === 15);
}
{
  const r = normalizeResult("≤0.01");
  check("≤0.01 → bound le 0.01",
    r !== null && r.bound?.op === "le" && Math.abs((r.bound?.value ?? NaN) - 0.01) < 1e-9);
}
{
  const r = normalizeResult("≦ 0.2");
  check("≦ 0.2 → bound le 0.2",
    r !== null && r.bound?.op === "le" && Math.abs((r.bound?.value ?? NaN) - 0.2) < 1e-9);
}
{
  const r = normalizeResult(">50");
  check(">50 → bound gt 50",
    r !== null && r.bound?.op === "gt" && r.bound?.value === 50);
}
{
  const r = normalizeResult("≥ 95");
  check("≥ 95 → bound ge 95",
    r !== null && r.bound?.op === "ge" && r.bound?.value === 95);
}
{
  const r = normalizeResult("388");
  check("388 → no bound, value 388",
    r !== null && r.bound === undefined && r.value === 388);
}
{
  const r = normalizeResult("White");
  check("White → null", r === null);
}
{
  const r = normalizeResult("1.09");
  check("1.09 → no bound, value 1.09",
    r !== null && r.bound === undefined && Math.abs(r.value - 1.09) < 1e-9);
}

// ── Evaluation tests ──────────────────────────────────────────────────────────

{
  const e = evaluateItem({ result: "<15", specRaw: "≤15" });
  check('result "<15", spec "≤15" → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "15 Max." });
  check('result "<15", spec "15 Max." → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "≤10" });
  check('result "<15", spec "≤10" → SKIP', e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<0.20", specRaw: "0.5 Max." });
  check('result "<0.20", spec "0.5 Max." → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: ">95", specRaw: "≥ 90" });
  check('result ">95", spec "≥ 90" → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: ">95", specRaw: "≥ 99" });
  check('result ">95", spec "≥ 99" → SKIP', e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "10-20" });
  check('result "<15", spec "10-20" (between) → SKIP', e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "≥ 5" });
  check('result "<15", spec "≥ 5" (opposite direction) → SKIP (must NOT be FAIL)',
    e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "387", specRaw: "275-425" });
  check('result "387", spec "275-425" → PASS (numeric control)', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
