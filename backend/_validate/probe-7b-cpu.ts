// does 7b run reliably on CPU (num_gpu:0), avoiding the VRAM CUDA crash? at what latency?
import axios from "axios";
import { extractText } from "../src/services/coa/coa-pipeline";
const DIR = "C:\\Users\\HP Omen\\Desktop\\uploads";
const FILES = ["20260507_SODA___ASH_Lot_60223.pdf", "20260507_Z99_2-3.5_Lot_Z25J29-8.pdf"];
const PROMPT = (t: string) => `Extract COA rows as JSON {"items":[{"name":...,"result":...}]}. ONLY JSON.\n\n${t}`;

async function main() {
  for (const f of FILES) {
    const { text } = await extractText(`${DIR}\\${f}`);
    for (const num_gpu of [0]) {
      const t0 = process.hrtime.bigint();
      try {
        const res = await axios.post(
          "http://localhost:11434/api/generate",
          { model: "qwen2.5:7b-instruct", prompt: PROMPT(text), stream: false, format: "json", keep_alive: "2m", options: { temperature: 0, num_ctx: 8192, num_gpu } },
          { timeout: 300_000 }
        );
        const p = JSON.parse(res.data.response);
        const secs = Number(process.hrtime.bigint() - t0) / 1e9;
        console.log(`${f.slice(0, 30).padEnd(30)} num_gpu=${num_gpu} → OK rows=${p.items?.length ?? "?"} in ${secs.toFixed(1)}s`);
      } catch (e: any) {
        const b = e?.response?.data;
        console.log(`${f.slice(0, 30).padEnd(30)} num_gpu=${num_gpu} → FAIL: ${typeof b === "object" ? JSON.stringify(b) : b ?? e?.message}`);
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
