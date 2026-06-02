// Throwaway diagnostic — for every PDF in uploads/, report whether it has a usable
// text-layer (no OCR needed) or will fall through to image OCR. Decides where "ค่าเพี้ยน"
// can originate: text-layer path = LLM problem; OCR path = OCR problem.
import * as fs from "fs";
import * as path from "path";
import { extractPdfText } from "../services/coa/pdf-text-extractor";

async function main() {
  const dir = path.join(__dirname, "..", "..", "uploads");
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  console.log(`file count: ${files.length}\n`);

  let textLayer = 0;
  let ocr = 0;
  for (const f of files) {
    try {
      const { text, hasUsableText, pageCount } = await extractPdfText(path.join(dir, f));
      const chars = text.replace(/\s/g, "").length;
      const path_ = hasUsableText ? "TEXT-LAYER" : "OCR-FALLBACK";
      if (hasUsableText) textLayer++;
      else ocr++;
      console.log(`${path_.padEnd(13)} ${String(chars).padStart(6)} chars  ${pageCount}p  ${f}`);
    } catch (e) {
      ocr++;
      console.log(`ERROR                ${(e as Error).message}  ${f}`);
    }
  }
  console.log(`\nTEXT-LAYER: ${textLayer}   OCR-FALLBACK: ${ocr}`);
}

main();
