// PROBE: dump pdfjs text tokens WITH x-coordinates for the header + data rows of a COA,
// to verify the core assumption of the header-anchored direction classifier:
//   does a lone spec bound's X-position actually fall under "Min.Spec" vs "Max.Spec" per its true role?
// run from backend/:  npx ts-node _validate/probe-geom.ts "<abs pdf path>"
import * as fs from "fs";
import * as path from "path";

const pdfjsDistPath = path.dirname(require.resolve("pdfjs-dist/package.json"));

async function main() {
  const f = process.argv[2] || "C:\\Users\\HP Omen\\Desktop\\uploads\\20260422_Barimite200_Lot_26031301.pdf";
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(f));
  const doc = await getDocument({
    data,
    cMapUrl: path.join(pdfjsDistPath, "cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfjsDistPath, "standard_fonts/"),
    useSystemFonts: true,
  }).promise;

  console.log(`=== ${path.basename(f)} — tokens with X (grouped by row Y) ===`);
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    interface T { str: string; x: number; y: number }
    const toks: T[] = [];
    for (const it of tc.items as any[]) {
      if (!it.str || !it.str.trim()) continue;
      toks.push({ str: it.str, x: Math.round(it.transform[4]), y: Math.round(it.transform[5]) });
    }
    // group into rows by Y
    toks.sort((a, b) => b.y - a.y || a.x - b.x);
    let lastY = toks.length ? toks[0].y : 0;
    let row: T[] = [];
    const flush = () => {
      if (!row.length) return;
      // only print rows likely to be header or a data row with a spec keyword/number
      const line = row.map((t) => `${t.str}@${t.x}`).join("  ");
      const joined = row.map((t) => t.str).join(" ");
      if (/min|max|spec|lower|upper|limit|moisture|ph|particle|d\s*100|mesh|ba\s*so4|gravity|result/i.test(joined)) {
        console.log(`  y=${row[0].y}:  ${line}`);
      }
      row = [];
    };
    for (const t of toks) {
      if (Math.abs(t.y - lastY) > 2) flush();
      row.push(t);
      lastY = t.y;
    }
    flush();
    page.cleanup();
  }
  await doc.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
