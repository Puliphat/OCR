// dump extracted text per page (no Ollama) — fixtures for product/lot recovery
// run from backend/:  npx ts-node _validate/_dump-text.ts "<dir>" "<outdir>"
import * as fs from "fs";
import * as path from "path";
import { extractTextPerPage } from "../src/services/coa/coa-pipeline";

async function main() {
  const dir = process.argv[2];
  const out = process.argv[3];
  fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort();
  for (const file of files) {
    const pages = await extractTextPerPage(path.join(dir, file));
    pages.forEach((pg, i) => {
      const name = `${file.replace(/\.pdf$/i, "")}__p${i + 1}.txt`;
      fs.writeFileSync(path.join(out, name), `engine=${pg.engine}\n\n${pg.text}`, "utf8");
      console.log(`${name}  engine=${pg.engine}  ${pg.text.length} chars`);
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
