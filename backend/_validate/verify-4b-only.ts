// VERIFY (4b only) — runs the REAL production runCoaPipeline per file (parity, incl. header-direction lever).
// run from backend/:  npx ts-node _validate/verify-4b-only.ts ["<dir>"]   (daemon :8765 + Ollama up)
import * as fs from "fs";
import * as path from "path";
import { runCoaPipeline } from "../src/services/coa/coa-pipeline";
import { EvaluatedItem } from "../src/services/coa/coa-evaluator";

const DIR = process.argv[2] || "C:\\Users\\HP Omen\\Desktop\\uploads";
process.env.OLLAMA_MODEL = "qwen3:4b";

const specStr = (r: EvaluatedItem) => {
  if (r.specRaw) return r.specRaw;
  if (r.min != null && r.max != null) return `${r.min}~${r.max}`;
  if (r.max != null) return `<=${r.max}`;
  if (r.min != null) return `>=${r.min}`;
  return "-";
};
const rowLine = (r: EvaluatedItem) =>
  `    ${r.status.padEnd(4)} ${r.needsReview ? "⚑" : " "} ${String(r.name).slice(0, 30).padEnd(30)} result=${String(r.result ?? "-").padEnd(9)} spec=${String(specStr(r)).padEnd(12)} ${r.reason}`;
const vc = (rs: EvaluatedItem[]) =>
  `${rs.filter((r) => r.status === "PASS").length}P/${rs.filter((r) => r.status === "FAIL").length}F/${rs.filter((r) => r.status === "SKIP").length}S`;

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)).sort();
  console.log(`VERIFY 4b-only (REAL runCoaPipeline) — ${files.length} PDFs\n${"=".repeat(90)}`);

  let p = 0, f = 0, s = 0, rows = 0, review = 0;
  const fails: string[] = [];
  for (const file of files) {
    try {
      const reports = await runCoaPipeline(path.join(DIR, file));
      for (const report of reports) {
        const rs: EvaluatedItem[] = report.rows;
        const pageLabel = reports.length > 1 ? ` [page ${report.page ?? "?"}]` : "";
        console.log(`\n# ${file}${pageLabel}  (engine=${report.debug?.ocrEngine})  ${vc(rs)}`);
        for (const r of rs) {
          console.log(rowLine(r));
          rows++;
          if (r.status === "PASS") p++;
          else if (r.status === "FAIL") { f++; fails.push(`${file}${pageLabel} :: ${r.name} (result=${r.result} spec=${specStr(r)})`); }
          else s++;
          if (r.needsReview) review++;
        }
      }
    } catch (e: any) {
      console.log(`\n# ${file}\n  pipeline FAILED: ${e?.message}`);
      continue;
    }
  }
  const vr = rows ? (((p + f) / rows) * 100).toFixed(0) : "0";
  console.log(`\n${"=".repeat(90)}\nSUMMARY 4b: ${p}P/${f}F/${s}S  rows=${rows}  verdict-rate=${vr}%  needsReview=${review}`);
  console.log(`FAIL rows (verify vs real doc — deceptive suspects):`);
  if (!fails.length) console.log("  none");
  for (const x of fails) console.log(`  ${x}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
