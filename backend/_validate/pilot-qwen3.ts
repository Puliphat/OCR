// PILOT: qwen3:4b (candidate, GPU-fit) vs qwen2.5:7b (incumbent, CPU-fallback) on the 16-file corpus.
// GO/NO-GO (no GT needed beyond Lot240521):
//   1. qwen3:4b loads on GPU (check `ollama ps` separately) + per-file latency drops vs 7b-CPU
//   2. Lot240521 (5-row GT) exact-match
//   3. where qwen3 disagrees with 7b → it abstains (SKIP) or is the MORE correct read (eyeball), NOT a new confident-wrong
// run from backend/: npx ts-node _validate/pilot-qwen3.ts ["<dir>"]
import * as fs from "fs";
import * as path from "path";
import { extractText } from "../src/services/coa/coa-pipeline";
import { OllamaCoaService, RawCoa, resetGpuState } from "../src/services/coa/ollama-coa.service";
import { recoverSpecsFromOcr, correctSpecDirectionFromOcr } from "../src/services/coa/spec-recovery";
import { dropUngroundedItems } from "../src/services/coa/coa-grounding";
import { evaluateCoa } from "../src/services/coa/coa-evaluator";

const DIR = process.argv[2] || "C:\\Users\\HP Omen\\Desktop\\uploads";
// A = incumbent (what production runs today), B = candidate
const A = "qwen2.5:7b-instruct";
const B = "qwen3:4b";

// Lot240521 ground truth: all 5 rows are PASS (in-spec), result = Average column
const GT_FILE = "20260203_Lot240521.pdf";
const GT = [
  { name: "Sieve Residue 500", result: 0.3, spec: "<=3", verdict: "PASS" },
  { name: "Sieve Residue 350", result: 42, spec: "15~45", verdict: "PASS" },
  { name: "Sieve Residue 150", result: 56, spec: "45~75", verdict: "PASS" },
  { name: "Sieve Residue under 150", result: 1.3, spec: "<=20", verdict: "PASS" },
  { name: "Bulk Density", result: 329, spec: "270~350", verdict: "PASS" },
];

interface Row { name: string; result: any; min: any; max: any; status: string }

function rows(raw: RawCoa, text: string, file: string): Row[] {
  const items = dropUngroundedItems(raw.items ?? [], text).kept;
  recoverSpecsFromOcr(items, text);
  correctSpecDirectionFromOcr(items, text);
  const ev = evaluateCoa({ filename: file, product: raw.product ?? null, lotNo: raw.lotNo ?? null, items });
  return ev.rows.map((r) => ({ name: r.name, result: r.result, min: r.min, max: r.max, status: r.status }));
}

function tokens(s: string): Set<string> {
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 2 || /\d/.test(t)));
}
function overlap(a: Set<string>, b: Set<string>): number { let n = 0; for (const t of a) if (b.has(t)) n++; return n; }
function findMatch(name: string, rs: Row[]): Row | null {
  const a = tokens(name); let best: Row | null = null, bestN = 0;
  for (const r of rs) { const n = overlap(a, tokens(r.name)); if (n > bestN) { bestN = n; best = r; } }
  return bestN >= 2 ? best : null;
}
const num = (v: any) => (v == null ? null : Number(v));
const eq = (a: any, b: any) => { const x = num(a), y = num(b); if (x == null && y == null) return true; if (x == null || y == null) return false; return Math.abs(x - y) < 0.06; };
const fmt = (r: Row) => `res=${r.result} min=${r.min} max=${r.max} [${r.status}]`;
const vc = (rs: Row[]) => `${rs.filter(r => r.status === "PASS").length}P/${rs.filter(r => r.status === "FAIL").length}F/${rs.filter(r => r.status === "SKIP").length}S`;

async function runModel(model: string, text: string, file: string): Promise<{ rows: Row[]; secs: string }> {
  process.env.OLLAMA_MODEL = model;
  resetGpuState();
  const t0 = process.hrtime.bigint();
  const raw = await new OllamaCoaService().parseCoa(text);
  const secs = (Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1);
  return { rows: raw ? rows(raw, text, file) : [], secs };
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)).sort();
  console.log(`PILOT ${files.length} PDFs in ${DIR}\nA(incumbent)=${A}  vs  B(candidate)=${B}\n${"=".repeat(90)}`);

  let totA = 0, totB = 0, skipA = 0, skipB = 0, secA = 0, secB = 0, fails = 0;
  for (const f of files) {
    const full = path.join(DIR, f);
    let text = "", engine = "";
    try { ({ text, engine } = await extractText(full)); }
    catch (e: any) { console.log(`\n# ${f}\n  extractText FAILED: ${e?.message}`); continue; }

    const ra = await runModel(A, text, f);
    const rb = await runModel(B, text, f);
    totA += ra.rows.length; totB += rb.rows.length;
    skipA += ra.rows.filter(r => r.status === "SKIP").length; skipB += rb.rows.filter(r => r.status === "SKIP").length;
    secA += Number(ra.secs); secB += Number(rb.secs);

    console.log(`\n# ${f}  (engine=${engine})   A:${vc(ra.rows)} ${ra.secs}s   B:${vc(rb.rows)} ${rb.secs}s   rows ${ra.rows.length}/${rb.rows.length}`);

    // GT exact-match dump for the labeled file
    if (f === GT_FILE) {
      console.log(`  --- Lot240521 GT (all 5 = PASS, result=Average) ---`);
      for (const g of GT) console.log(`    GT  ${g.name.padEnd(24)} res=${g.result} spec=${g.spec} [${g.verdict}]`);
      console.log(`  A rows:`); for (const r of ra.rows) console.log(`    A   ${r.name.slice(0, 24).padEnd(24)} ${fmt(r)}`);
      console.log(`  B rows:`); for (const r of rb.rows) console.log(`    B   ${r.name.slice(0, 24).padEnd(24)} ${fmt(r)}`);
    }

    // disagreement proxy: A vs B differ on a matched row
    for (const r of ra.rows) {
      const m = findMatch(r.name, rb.rows);
      if (!m) { console.log(`  ? ${r.name.slice(0, 26).padEnd(26)} only-A   ${fmt(r)}`); fails++; continue; }
      if (!eq(r.result, m.result) || !eq(r.min, m.min) || !eq(r.max, m.max)) {
        console.log(`  ⚠ ${r.name.slice(0, 26).padEnd(26)} DISAGREE  A:${fmt(r)}  ||  B:${fmt(m)}`); fails++;
      }
    }
    for (const r of rb.rows) if (!findMatch(r.name, ra.rows)) { console.log(`  ? ${r.name.slice(0, 26).padEnd(26)} only-B   ${fmt(r)}`); fails++; }
  }

  console.log(`\n${"=".repeat(90)}\nSUMMARY`);
  console.log(`  A ${A.padEnd(22)} rows=${totA} skip=${skipA} (${(skipA / totA * 100).toFixed(0)}% abstain)  total ${secA.toFixed(0)}s  avg ${(secA / files.length).toFixed(1)}s/file`);
  console.log(`  B ${B.padEnd(22)} rows=${totB} skip=${skipB} (${(skipB / totB * 100).toFixed(0)}% abstain)  total ${secB.toFixed(0)}s  avg ${(secB / files.length).toFixed(1)}s/file`);
  console.log(`  disagreement/only-one rows flagged: ${fails}`);
  console.log(`  legend: ⚠ DISAGREE / ? only-one = eyeball whether B resolved toward SKIP-or-correct (GO) or new confident-wrong (NO-GO)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
