// dev harness — เทียบ reconstructText (current) vs reconstructTextGrid (column-aware) บนไฟล์จริง
// cache post-rotation tokens ไว้ _validate/_tokens/ เพื่อ iterate algorithm โดยไม่ต้อง re-OCR
// run: npx ts-node _validate/grid-probe.ts [colGapMul]
import * as fs from "fs";
import * as path from "path";
import { RapidOcrService, OcrToken } from "../src/services/coa/rapidocr.service";

const UPLOADS = "C:\\Users\\HP Omen\\Desktop\\uploads";
const TOKDIR = path.join(__dirname, "_tokens");

// ไฟล์ rapidocr ที่สนใจ (problem + good) — .png ถูก render ไว้แล้วใน uploads
const FILES = [
  "20260409_RI-015_Lot_EC250306801.png", // 2-table rotated (column-shift)
  "20260420_PR1950W_Lot_4063-01_4063-02.png", // ragged row (spec-shift)
  "20260323_ZP10_Lot.2026021327.png", // dropped result
  "20260203_Lot240521.png", // rotated, multi-measurement
  "20260513_D-2072.png", // good (baseline parity)
  "20260514_4A_Lot_34002411172.png", // good
];

async function tokensFor(file: string): Promise<OcrToken[] | null> {
  fs.mkdirSync(TOKDIR, { recursive: true });
  const cache = path.join(TOKDIR, file + ".json");
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const svc = new RapidOcrService();
  const toks = await svc.getProcessedTokens(path.join(UPLOADS, file));
  if (toks) fs.writeFileSync(cache, JSON.stringify(toks));
  return toks;
}

async function main() {
  const mul = process.argv[2] ? Number(process.argv[2]) : 1.5;
  const svc = new RapidOcrService();
  for (const file of FILES) {
    const toks = await tokensFor(file);
    console.log("\n" + "=".repeat(100) + `\n### ${file}  (tokens=${toks?.length ?? 0})`);
    if (!toks) {
      console.log("  (no tokens — daemon down?)");
      continue;
    }
    console.log("--- CURRENT reconstructText ---");
    console.log(svc.reconstructText(toks));
    console.log(`--- GRID reconstructTextGrid (colGapMul=${mul}) ---`);
    console.log(svc.reconstructTextGrid(toks, { colGapMul: mul }));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
