import * as path from "path";
import * as Tesseract from "tesseract.js";
import { PdfService } from "../pdf.service";
import { ImageProcessingService } from "../image-processing.service";
import { OllamaCoaService } from "./ollama-coa.service";
import { evaluateCoa, CoaReport } from "./coa-evaluator";
import { extractPdfText } from "./pdf-text-extractor";

export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  // 1. For PDFs: try text layer first — free, no OCR needed if it works
  if (ext === ".pdf") {
    try {
      const { text, hasUsableText } = await extractPdfText(filePath);
      if (hasUsableText) {
        console.log(`  [text-layer] ${text.length} chars`);
        return text;
      }
      console.log(`  [text-layer] empty/scanned — falling back to OCR`);
    } catch (e) {
      console.warn(`  [text-layer] failed:`, (e as Error).message);
    }
  }

  // 2. OCR fallback (Tesseract only — Typhoon needs 7.5GB so skipped for now)
  let imagePath = filePath;
  if (ext === ".pdf") {
    const imgs = await new PdfService().convertToImage(filePath);
    imagePath = imgs[0];
  }
  const processed = await new ImageProcessingService().processImage(imagePath);
  console.log(`  [tesseract] running…`);
  const { data } = await Tesseract.recognize(processed, "eng+tha");
  console.log(`  [tesseract] ${data.text.length} chars`);
  return data.text;
}

export async function runCoaPipeline(filePath: string): Promise<CoaReport> {
  const filename = path.basename(filePath);
  const ollama = new OllamaCoaService();

  const text = await extractText(filePath);
  if (!text.trim()) {
    return {
      filename,
      product: null,
      lotNo: null,
      rows: [],
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
    };
  }

  console.log(`  [ollama] parsing…`);
  const raw = await ollama.parseCoa(text);
  if (!raw) {
    return {
      filename,
      product: null,
      lotNo: null,
      rows: [],
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
    };
  }

  return evaluateCoa({
    filename,
    product: raw.product ?? null,
    lotNo: raw.lotNo ?? null,
    items: raw.items ?? [],
  });
}
