// dump structural grid (pdfplumber) + deterministic parse for one PDF — ดูว่า grid เห็นช่องอย่างไร
// run from backend/:  npx ts-node _validate/_dump-grid.ts "<file.pdf>"
import { extractPdfGridPerPage } from "../src/services/coa/pdf-grid-extractor";
import { parseStructuralGrid } from "../src/services/coa/parse-structural-grid";

const file = process.argv[2];
for (const p of extractPdfGridPerPage(file)) {
  console.log(`\n===== page ${p.page} · source=${p.source} · orient=${p.orient ?? "normal"} =====`);
  console.log(p.grid);
  console.log("----- parsed -----");
  console.log(JSON.stringify(parseStructuralGrid(p.grid, p.orient ?? "normal"), null, 1));
}
