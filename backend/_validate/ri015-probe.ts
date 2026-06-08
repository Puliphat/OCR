// one-shot: รัน pipeline จริงบน RI-015 → ดู llmRaw + rows (name/result/status) ของ sieve table
import { runCoaPipeline } from "../src/services/coa/coa-pipeline";

const FILE = "C:\\Users\\HP Omen\\Desktop\\uploads\\20260409_RI-015_Lot_EC250306801.png";

async function main() {
  process.env.RAPIDOCR_REQUIRED = "true";
  const reps = await runCoaPipeline(FILE);
  const rep = reps[0];
  console.log("\n===== LLM RAW =====");
  console.log(rep.debug?.llmRaw ?? "(none)");
  console.log("\n===== ROWS =====");
  for (const r of rep.rows) {
    console.log(
      `${r.status.padEnd(4)} name=${JSON.stringify(r.name).padEnd(28)} result=${String(r.result).padEnd(8)} resultRaw=${JSON.stringify(r.resultRaw ?? "").padEnd(10)} spec=[${r.min},${r.max}] review=${r.needsReview} :: ${r.reason}`
    );
  }
  console.log(`\nSUMMARY ${rep.summary.pass}P ${rep.summary.fail}F ${rep.summary.skip}S`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
