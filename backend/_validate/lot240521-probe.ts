// probe: รัน pipeline จริงบน Lot240521 → ดู OCR lines + sieve rows + ทำไม pass-guard downgrade 350μ
import { runCoaPipeline } from "../src/services/coa/coa-pipeline";

const FILE = "C:\\Users\\HP Omen\\Desktop\\uploads\\20260203_Lot240521.pdf";

async function main() {
  process.env.RAPIDOCR_REQUIRED = "true";
  process.env.OLLAMA_MODEL = "qwen3:4b";
  const reps = await runCoaPipeline(FILE);
  const rep = reps[0];

  const ocr = rep.debug?.ocrText ?? "";
  console.log("===== OCR LINES =====");
  ocr.split(/\r?\n/).forEach((l, i) => console.log(`${String(i).padStart(3)}| ${l}`));

  console.log("\n===== LLM RAW =====");
  console.log(rep.debug?.llmRaw ?? "(none)");

  console.log("\n===== ROWS =====");
  for (const r of rep.rows) {
    console.log(
      `${r.status.padEnd(4)} name=${JSON.stringify(r.name).padEnd(34)} result=${String(r.result).padEnd(8)} resultRaw=${JSON.stringify(r.resultRaw ?? "").padEnd(10)} spec=[${r.min},${r.max}] specRaw=${JSON.stringify(r.specRaw ?? "")} review=${r.needsReview} :: ${r.reason}`
    );
  }
  console.log(`\nSUMMARY ${rep.summary.pass}P ${rep.summary.fail}F ${rep.summary.skip}S`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
