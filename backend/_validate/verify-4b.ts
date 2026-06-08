// VERIFY: qwen3:4b (new default) vs qwen2.5:7b — through the FULL production guard chain.
// Unlike pilot-qwen3.ts (which skipped fail/pass guards), this replicates runCoaPipeline EXACTLY
// (drop → recover → spec-direction → evaluate → fail-guard → pass-guard → summarize), so the
// numbers here ARE what production would emit. OCR runs ONCE per file → both models see identical text.
//
// Answers two questions the user asked:
//   1. "% เยอะรึยัง" — per-model verdict rate (PASS+FAIL = confident) vs abstain (SKIP), + Lot240521 GT.
//   2. "ดูค่าจริงด้วย อย่าเชื่อ PASS/FAIL อย่างเดียว" — dumps result/spec PER ROW so values are auditable,
//      flags every FAIL (corpus baseline = 0 FAIL) and every needsReview as a deceptive-verdict suspect.
//
// run from backend/:  npx ts-node _validate/verify-4b.ts ["<dir>"]   (daemon :8765 + Ollama must be up)
import * as fs from "fs";
import * as path from "path";
import { extractText } from "../src/services/coa/coa-pipeline";
import { OllamaCoaService, RawCoa, resetGpuState } from "../src/services/coa/ollama-coa.service";
import { recoverSpecsFromOcr, correctSpecDirectionFromOcr } from "../src/services/coa/spec-recovery";
import {
  dropUngroundedItems,
  downgradeUngroundedFails,
  downgradeUngroundedPasses,
} from "../src/services/coa/coa-grounding";
import { evaluateCoa, summarize, EvaluatedItem } from "../src/services/coa/coa-evaluator";

const DIR = process.argv[2] || "C:\\Users\\HP Omen\\Desktop\\uploads";
const A = "qwen2.5:7b-instruct"; // incumbent
const B = "qwen3:4b"; // new default

// Lot240521 ground truth (the one labeled file): all 5 rows PASS, result = Average column
const GT_FILE = "20260203_Lot240521.pdf";
const GT: { name: string; result: number; spec: string }[] = [
  { name: "Sieve Residue 500", result: 0.3, spec: "<=3" },
  { name: "Sieve Residue 350", result: 42, spec: "15~45" },
  { name: "Sieve Residue 150", result: 56, spec: "45~75" },
  { name: "Sieve Residue under 150", result: 1.3, spec: "<=20" },
  { name: "Bulk Density", result: 329, spec: "270~350" },
];

// EXACT replica of runCoaPipeline's post-parse guard chain (coa-pipeline.ts:171-227)
function fullEvaluate(raw: RawCoa, text: string, file: string): { rows: EvaluatedItem[]; sum: any } {
  const items = dropUngroundedItems(raw.items ?? [], text).kept;
  recoverSpecsFromOcr(items, text);
  correctSpecDirectionFromOcr(items, text);
  const ev = evaluateCoa({ filename: file, product: raw.product ?? null, lotNo: raw.lotNo ?? null, items });
  downgradeUngroundedFails(ev.rows, text);
  downgradeUngroundedPasses(ev.rows, text);
  ev.summary = summarize(ev.rows);
  return { rows: ev.rows, sum: ev.summary };
}

const specStr = (r: EvaluatedItem) => {
  if (r.specRaw) return r.specRaw;
  const lo = r.min == null ? "" : r.min;
  const hi = r.max == null ? "" : r.max;
  if (r.min != null && r.max != null) return `${lo}~${hi}`;
  if (r.max != null) return `<=${hi}`;
  if (r.min != null) return `>=${lo}`;
  return "-";
};
const rowLine = (tag: string, r: EvaluatedItem) =>
  `    ${tag} ${r.status.padEnd(4)} ${r.needsReview ? "⚑" : " "} ${String(r.name).slice(0, 30).padEnd(30)} result=${String(r.result ?? "-").padEnd(9)} spec=${String(specStr(r)).padEnd(12)} ${r.reason}`;
const vc = (rs: EvaluatedItem[]) =>
  `${rs.filter((r) => r.status === "PASS").length}P/${rs.filter((r) => r.status === "FAIL").length}F/${rs.filter((r) => r.status === "SKIP").length}S`;

const num = (v: any) => (v == null ? null : Number(v));
const close = (a: any, b: any) => {
  const x = num(a), y = num(b);
  if (x == null || y == null) return false;
  return Math.abs(x - y) < 0.06 || (String(Math.round(x * 1000)) === String(Math.round(y * 1000)));
};

interface Tot { p: number; f: number; s: number; rows: number; secs: number; review: number; fails: string[] }
const mk = (): Tot => ({ p: 0, f: 0, s: 0, rows: 0, secs: 0, review: 0, fails: [] });
function tally(t: Tot, rows: EvaluatedItem[], secs: number, file: string) {
  t.secs += secs;
  for (const r of rows) {
    t.rows++;
    if (r.status === "PASS") t.p++;
    else if (r.status === "FAIL") { t.f++; t.fails.push(`${file} :: ${r.name} (result=${r.result} spec=${specStr(r)})`); }
    else t.s++;
    if (r.needsReview) t.review++;
  }
}

async function runModel(model: string, text: string, file: string) {
  process.env.OLLAMA_MODEL = model;
  resetGpuState();
  const t0 = process.hrtime.bigint();
  const raw = await new OllamaCoaService().parseCoa(text);
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const ev = raw ? fullEvaluate(raw, text, file) : { rows: [] as EvaluatedItem[], sum: null };
  return { rows: ev.rows, secs };
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)).sort();
  console.log(`VERIFY (full guard chain) — ${files.length} PDFs in ${DIR}`);
  console.log(`A=${A} (incumbent)   B=${B} (new default)\n${"=".repeat(95)}`);

  const tA = mk(), tB = mk();
  let gtA = "", gtB = "";

  for (const f of files) {
    const full = path.join(DIR, f);
    let text = "", engine = "";
    try { ({ text, engine } = await extractText(full)); }
    catch (e: any) { console.log(`\n# ${f}\n  extractText FAILED: ${e?.message}`); continue; }

    const ra = await runModel(A, text, f);
    const rb = await runModel(B, text, f);
    tally(tA, ra.rows, ra.secs, f);
    tally(tB, rb.rows, rb.secs, f);

    console.log(`\n# ${f}  (engine=${engine})   A:${vc(ra.rows)} ${ra.secs.toFixed(1)}s   B:${vc(rb.rows)} ${rb.secs.toFixed(1)}s`);
    console.log(`  -- A (${A}) --`);
    for (const r of ra.rows) console.log(rowLine("A", r));
    console.log(`  -- B (${B}) --`);
    for (const r of rb.rows) console.log(rowLine("B", r));

    if (f === GT_FILE) {
      let okA = 0, okB = 0;
      const chk = (rows: EvaluatedItem[]) => {
        let ok = 0;
        for (const g of GT) {
          const m = rows.find((r) => {
            const a = g.name.toLowerCase().split(/\s+/);
            const b = r.name.toLowerCase();
            return a.filter((t) => b.includes(t)).length >= 2;
          });
          if (m && m.status === "PASS" && close(m.result, g.result)) ok++;
        }
        return ok;
      };
      okA = chk(ra.rows); okB = chk(rb.rows);
      gtA = `${okA}/5`; gtB = `${okB}/5`;
      console.log(`  ★ GT Lot240521: A matched ${gtA} rows (PASS + correct value), B matched ${gtB}`);
    }
  }

  const pct = (t: Tot) => (t.rows ? (((t.p + t.f) / t.rows) * 100).toFixed(0) : "0");
  console.log(`\n${"=".repeat(95)}\nSUMMARY (full production guard chain)`);
  for (const [name, t, gt] of [[A, tA, gtA], [B, tB, gtB]] as [string, Tot, string][]) {
    console.log(
      `  ${name.padEnd(22)} ${t.p}P/${t.f}F/${t.s}S  rows=${t.rows}  verdict-rate=${pct(t)}% (PASS+FAIL)  needsReview=${t.review}  GT=${gt}  ${t.secs.toFixed(0)}s (${(t.secs / files.length).toFixed(1)}s/file)`
    );
  }
  console.log(`\n  FAIL rows (corpus baseline = 0 FAIL → every one is a deceptive-verdict SUSPECT, verify vs real doc):`);
  for (const [name, t] of [[A, tA], [B, tB]] as [string, Tot][]) {
    if (!t.fails.length) console.log(`    ${name}: none ✓`);
    else for (const x of t.fails) console.log(`    ${name}: ${x}`);
  }
  console.log(`\n  ⚑ = needsReview flag.  verdict-rate high = confident; but cross-check FAIL + ⚑ rows against the actual PDF.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
