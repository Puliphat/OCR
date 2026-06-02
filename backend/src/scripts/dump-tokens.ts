// One-off: dump RapidOCR tokens (with boxes) เป็น JSON เพื่อดู geometry จริง
// รัน: npx ts-node src/scripts/dump-tokens.ts <imageOrPdf> [outName]
import * as fs from "fs";
import * as path from "path";
import { PdfService } from "../services/pdf.service";
import { RapidOcrService } from "../services/coa/rapidocr.service";

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: dump-tokens.ts <file> [outName]");
    process.exit(1);
  }
  const abs = path.isAbsolute(target)
    ? target
    : path.join(__dirname, "..", "..", "uploads", target);

  let imagePath = abs;
  if (path.extname(abs).toLowerCase() === ".pdf") {
    const imgs = await new PdfService().convertToImage(abs);
    imagePath = imgs[0];
  }

  const svc = new RapidOcrService();
  const toks = await svc.ocrTokens(imagePath);
  if (!toks) {
    console.error("daemon returned null (unreachable?)");
    process.exit(1);
  }

  const outName = process.argv[3] || path.basename(target) + ".tokens.json";
  const outDir = path.join(__dirname, "..", "..", "coa-logs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, outName);
  fs.writeFileSync(outPath, JSON.stringify(toks, null, 2), "utf8");

  // also print a compact y-sorted view
  const sorted = [...toks].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of sorted) {
    console.log(
      `y=${t.y.toFixed(0).padStart(5)} [${t.y1.toFixed(0)}-${t.y2.toFixed(0)}]  x=${t.x
        .toFixed(0)
        .padStart(5)}-${t.x2.toFixed(0).padStart(5)}  ${JSON.stringify(t.text)}`
    );
  }
  console.log(`\n${toks.length} tokens -> ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
