// dump OCR tokens (x,y) per page — used to design geometry-based recovery modules
// run from backend/:  npx ts-node _validate/_dump-tokens.ts "<pdf>" 
import * as path from "path";
import { extractTextPerPage } from "../src/services/coa/coa-pipeline";

async function main() {
  const file = process.argv[2];
  const pages = await extractTextPerPage(file);
  pages.forEach((pg, i) => {
    console.log(`\n===== page ${i + 1} engine=${pg.engine} tokens=${(pg as any).tokens?.length ?? 0} =====`);
    const toks = ((pg as any).tokens ?? []) as { text: string; x: number; x2: number; y: number; y1: number; y2: number }[];
    for (const t of [...toks].sort((a, b) => a.y - b.y || a.x - b.x)) {
      console.log(`y=${t.y.toFixed(0).padStart(5)} [${t.y1.toFixed(0)}..${t.y2.toFixed(0)}]  x=${t.x.toFixed(0).padStart(5)}..${t.x2.toFixed(0).padStart(5)}  ${JSON.stringify(t.text)}`);
    }
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
