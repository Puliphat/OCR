// Sweep all COA files in a dir, flag SUSPECT rows without ground truth:
//   signal = 3b vs 7b disagree on result/spec for the same row (instability = likely misread)
//   + show production verdict + which rows the guards turned to SKIP/needsReview
// run from backend/: npx ts-node _validate/sweep.ts ["<dir>"]
import * as fs from "fs";
import * as path from "path";
import { extractText } from "../src/services/coa/coa-pipeline";
import { OllamaCoaService, RawCoa, resetGpuState } from "../src/services/coa/ollama-coa.service";
import { recoverSpecsFromOcr, correctSpecDirectionFromOcr } from "../src/services/coa/spec-recovery";
import { dropUngroundedItems } from "../src/services/coa/coa-grounding";
import { evaluateCoa } from "../src/services/coa/coa-evaluator";

const DIR = process.argv[2] || "C:\\Users\\HP Omen\\Desktop\\uploads";
const MODELS = ["qwen2.5:3b-instruct", "qwen2.5:7b-instruct"];

interface Row { name: string; result: any; min: any; max: any; status: string }

function rows(raw: RawCoa, text: string, file: string): Row[] {
  const items = dropUngroundedItems(raw.items ?? [], text).kept;
  recoverSpecsFromOcr(items, text);
  correctSpecDirectionFromOcr(items, text);
  const ev = evaluateCoa({ filename: file, product: raw.product ?? null, lotNo: raw.lotNo ?? null, items });
  return ev.rows.map((r) => ({ name: r.name, result: r.result, min: r.min, max: r.max, status: r.status }));
}

// align rows across models by name-token overlap
function tokens(s: string): Set<string> {
  return new Set((s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 2 || /\d/.test(t)));
}
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}
function findMatch(name: string, rows: Row[]): Row | null {
  const a = tokens(name);
  let best: Row | null = null, bestN = 0;
  for (const r of rows) {
    const n = overlap(a, tokens(r.name));
    if (n > bestN) { bestN = n; best = r; }
  }
  return bestN >= 2 ? best : null;
}
const num = (v: any) => (v == null ? null : Number(v));
const eq = (a: any, b: any) => {
  const x = num(a), y = num(b);
  if (x == null && y == null) return true;
  if (x == null || y == null) return false;
  return Math.abs(x - y) < 0.06;
};
const fmt = (r: Row) => `res=${r.result} min=${r.min} max=${r.max} [${r.status}]`;

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)).sort();
  console.log(`Sweep ${files.length} PDFs in ${DIR}\n${MODELS.join(" vs ")}\n${"=".repeat(80)}`);

  for (const f of files) {
    const full = path.join(DIR, f);
    let text = "", engine = "";
    try { ({ text, engine } = await extractText(full)); }
    catch (e: any) { console.log(`\n# ${f}\n  extractText FAILED: ${e?.message}`); continue; }

    const byModel: Record<string, Row[]> = {};
    for (const m of MODELS) {
      process.env.OLLAMA_MODEL = m;
      resetGpuState(); // อย่าให้ GPU-crash latch ของ model ก่อนหน้าลาก model นี้ไป CPU
      const raw = await new OllamaCoaService().parseCoa(text);
      byModel[m] = raw ? rows(raw, text, f) : [];
    }
    const [A, B] = MODELS;
    const ra = byModel[A], rb = byModel[B];
    const vc = (rs: Row[]) => `${rs.filter(r => r.status === "PASS").length}P/${rs.filter(r => r.status === "FAIL").length}F/${rs.filter(r => r.status === "SKIP").length}S`;
    console.log(`\n# ${f}  (engine=${engine})   3b:${vc(ra)}  7b:${vc(rb)}  rows ${ra.length}/${rb.length}`);

    let suspects = 0;
    for (const r of ra) {
      const m = findMatch(r.name, rb);
      if (!m) { console.log(`  ? ${r.name.slice(0, 28).padEnd(28)} only-3b   ${fmt(r)}`); suspects++; continue; }
      if (!eq(r.result, m.result) || !eq(r.min, m.min) || !eq(r.max, m.max)) {
        console.log(`  ⚠ ${r.name.slice(0, 28).padEnd(28)} DISAGREE  3b:${fmt(r)}  ||  7b:${fmt(m)}`); suspects++;
      }
    }
    for (const r of rb) if (!findMatch(r.name, ra)) { console.log(`  ? ${r.name.slice(0, 28).padEnd(28)} only-7b   ${fmt(r)}`); suspects++; }
    if (!suspects) console.log(`  ✓ no disagreement (3b & 7b match on every row)`);
  }
  console.log(`\n${"=".repeat(80)}\nlegend: ⚠ DISAGREE = models read row differently (eyeball vs real doc) · ? = only one model found row`);
}
main().catch((e) => { console.error(e); process.exit(1); });
