// confirm 7b 500 = OOM? + does lower num_ctx let 7b fit on big files?
// run from backend/: npx ts-node _validate/probe-7b-mem.ts
import axios from "axios";
import * as os from "os";
import { extractText } from "../src/services/coa/coa-pipeline";

const DIR = "C:\\Users\\HP Omen\\Desktop\\uploads";
const FILES = [
  "20260507_Z99_2-3.5_Lot_Z25J29-8.pdf", // text-layer, 13 rows (3b worked, 7b 500)
  "20260507_SODA___ASH_Lot_60223.pdf",   // rapidocr, 704 chars (7b 500)
];
const CTXS = [8192, 4096, 2048];
const PROMPT = (t: string) => `Extract COA rows as JSON {"items":[{"name":...,"result":...}]}. ONLY JSON.\n\n${t}`;
const freeGiB = () => (os.freemem() / 1024 ** 3).toFixed(2);

async function try7b(text: string, num_ctx: number) {
  try {
    const res = await axios.post(
      "http://localhost:11434/api/generate",
      { model: "qwen2.5:7b-instruct", prompt: PROMPT(text), stream: false, format: "json", keep_alive: 0, options: { temperature: 0, num_ctx } },
      { timeout: 180_000 }
    );
    const r = res.data.response;
    const p = JSON.parse(typeof r === "string" ? r : JSON.stringify(r));
    return `OK rows=${Array.isArray(p.items) ? p.items.length : "?"}`;
  } catch (e: any) {
    const b = e?.response?.data;
    return `FAIL ${e?.response?.status ?? ""}: ${typeof b === "object" ? JSON.stringify(b) : b ?? e?.message}`;
  }
}

async function main() {
  for (const f of FILES) {
    const { text, engine } = await extractText(`${DIR}\\${f}`);
    console.log(`\n# ${f} (engine=${engine}, ${text.length} chars)`);
    for (const c of CTXS) {
      const before = freeGiB();
      const r = await try7b(text, c);
      console.log(`  num_ctx=${String(c).padEnd(5)} freeRAM~${before}GiB → ${r}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
