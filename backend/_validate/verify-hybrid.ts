// verify GPU→CPU fallback ใน OllamaCoaService.parseCoa (default = 7b) คืน rows จริงบนไฟล์ที่เคย crash
import { extractText } from "../src/services/coa/coa-pipeline";
import { OllamaCoaService } from "../src/services/coa/ollama-coa.service";
const DIR = "C:\\Users\\HP Omen\\Desktop\\uploads";
const FILES = ["20260507_SODA___ASH_Lot_60223.pdf", "20260507_Z99_2-3.5_Lot_Z25J29-8.pdf"];
async function main() {
  console.log(`default model = ${new OllamaCoaService().modelName}`);
  for (const f of FILES) {
    const { text } = await extractText(`${DIR}\\${f}`);
    const t0 = process.hrtime.bigint();
    const raw = await new OllamaCoaService().parseCoa(text);
    const secs = (Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1);
    console.log(`${f.slice(0, 30).padEnd(30)} → rows=${raw?.items?.length ?? "NULL"} in ${secs}s`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
