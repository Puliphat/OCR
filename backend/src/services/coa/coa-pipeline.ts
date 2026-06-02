// ★ หัวใจของระบบ ★ — orchestrator 3 ขั้น: extract text → LLM parse → evaluate
// แก้ลำดับขั้น/เปลี่ยน OCR engine/เปลี่ยน LLM service ที่นี่
import * as fs from "fs";
import * as path from "path";
import * as Tesseract from "tesseract.js";
import { PdfService } from "../pdf.service";
import { ImageProcessingService } from "../image-processing.service";
import { OllamaCoaService } from "./ollama-coa.service";
import { RapidOcrService } from "./rapidocr.service";
import { evaluateCoa, CoaReport } from "./coa-evaluator";
import { extractPdfText } from "./pdf-text-extractor";
import { recoverSpecsFromOcr, correctSpecDirectionFromOcr } from "./spec-recovery";
import { dropUngroundedItems } from "./coa-grounding";

// Debug: dump OCR text + Ollama response ของ run ล่าสุดไว้ที่ coa-logs/_last-*.txt
// overwrite ทุก run — เปิดดูได้เมื่อ pipeline คืน rows ว่างเพื่อหาว่าพังขั้นไหน
const DEBUG_DIR = path.join(__dirname, "..", "..", "..", "coa-logs");
function dumpDebug(name: string, content: string) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, name), content, "utf8");
  } catch {
    /* ignore — debug only */
  }
}

// Step 1 — ดึงข้อความออกจากไฟล์
// RapidOCR = default OCR (แม่นกว่า Tesseract มากบนตาราง COA, CPU ~300MB) — ปิดด้วย USE_RAPIDOCR=false
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

  // render PDF → PNG
  let imagePath = filePath;
  if (ext === ".pdf") {
    const imgs = await new PdfService().convertToImage(filePath);
    imagePath = imgs[0];
  }

  // 2. RapidOCR sidecar (primary OCR) — Python daemon, แม่นกว่า Tesseract มากบนตาราง COA scan
  //    ต้อง start daemon ก่อน: `npm run ocr:daemon` (หรือ ocr-py/ocr_server.py). ปิดด้วย USE_RAPIDOCR=false
  //    daemon ล่ม/unreachable → คืน null → fall through ไป Tesseract อัตโนมัติ
  if (process.env.USE_RAPIDOCR !== "false") {
    console.log(`  [rapidocr] OCR via sidecar…`);
    const text = await new RapidOcrService().extractText(imagePath);
    if (text && text.replace(/\s/g, "").length >= 50) {
      console.log(`  [rapidocr] ${text.length} chars`);
      return text;
    }
    console.warn(`  [rapidocr] empty/unreachable — falling back to Tesseract`);
  }

  // 3. Tesseract multi-rotation OCR (fallback) — ใช้เมื่อ RapidOCR daemon ล่ม/อ่านไม่ได้
  // บาง scan/PDF มาเอียง 90/180/270° → text เป็นขยะถ้าไม่หมุนก่อน
  // จัดลำดับลองตาม aspect ratio (portrait ลอง 90/270 ก่อน), pick by Tesseract confidence
  // Early exit ถ้า confidence ≥ 75 — ไฟล์ orientation ปกติยังเร็ว 1 pass เท่าเดิม
  const proc = new ImageProcessingService();
  const meta = await proc.metadata(imagePath);
  const isPortrait = (meta.height ?? 0) > (meta.width ?? 0);
  const order: number[] = isPortrait
    ? [90, 270, 0, 180]
    : [0, 180, 90, 270];

  let best = { text: "", confidence: -1, angle: 0 };
  for (const angle of order) {
    console.log(`  [tesseract] try ${angle}°…`);
    const buf = await proc.preprocess(imagePath, angle);
    const { data } = await Tesseract.recognize(buf, "eng+tha", {
      // PSM 6 = assume uniform text block (เหมาะกับตาราง COA มากกว่า auto)
      // preserve_interword_spaces=1 รักษา space ระหว่างคอลัมน์ ช่วยแยก result/spec
      // เก็บ "|" ไว้ (LLM ใช้เป็น column boundary signal)
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
    } as any);
    console.log(
      `  [tesseract] ${angle}°: ${data.text.length} chars, conf ${data.confidence.toFixed(1)}`
    );
    if (data.confidence > best.confidence) {
      best = { text: data.text, confidence: data.confidence, angle };
    }
    if (data.confidence >= 75) {
      console.log(`  [tesseract] picked ${angle}° (conf ≥ 75)`);
      return data.text;
    }
  }
  console.log(
    `  [tesseract] best rotation: ${best.angle}° (conf ${best.confidence.toFixed(1)})`
  );
  return best.text;
}

// Entry point ของ pipeline — เรียกจากทั้ง HTTP route และ CLI (test-coa.ts)
// คืน CoaReport ที่ evaluate เสร็จแล้ว พร้อม summary PASS/FAIL/SKIP
export async function runCoaPipeline(filePath: string): Promise<CoaReport> {
  const filename = path.basename(filePath);
  const ollama = new OllamaCoaService();

  const text = await extractText(filePath);
  dumpDebug("_last-ocr.txt", text);
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
    console.log(`  [ollama] parse failed / no items`);
    return {
      filename,
      product: null,
      lotNo: null,
      rows: [],
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
    };
  }
  console.log(`  [ollama] parsed ${raw.items?.length ?? 0} items`);

  // ★ Anti-hallucination ★ — ตัด row ที่ชื่อ+ค่าไม่มีใน OCR เลย (LLM ปั้นทั้งใบเมื่อ OCR เป็นขยะ)
  //   กัน false-PASS อันตรายสุด: ส่งงานบอก "ผ่าน" จากข้อมูลที่ไม่มีอยู่จริงในเอกสาร
  const grounding = dropUngroundedItems(raw.items ?? [], text);
  if (grounding.dropped.length > 0) {
    console.warn(
      `  [grounding] ตัด ${grounding.dropped.length} row ที่ไม่มีใน OCR (น่าจะ hallucination): ${grounding.dropped
        .map((d) => d.name)
        .join(", ")}`
    );
    raw.items = grounding.kept;
  }

  // กู้คืน spec ที่ LLM (โมเดลเล็ก) หล่นทิ้งบางรัน — เติมเฉพาะ row ที่ spec ว่าง ★ ไม่ทับของเดิม ★
  const rec = recoverSpecsFromOcr(raw.items ?? [], text);
  if (rec.recovered > 0) {
    console.log(`  [spec-recovery] เติม spec จาก OCR ${rec.recovered} รายการ (${rec.mode})`);
  }

  // แก้ทิศ spec ที่ LLM ใส่ผิดช่อง (bare bound) โดยยึด operator ใน OCR (X Max/Min, ≤/≥) — กัน fabricated FAIL
  const fixed = correctSpecDirectionFromOcr(raw.items ?? [], text);
  if (fixed > 0) {
    console.log(`  [spec-direction] แก้ทิศ spec จาก OCR ${fixed} รายการ`);
  }

  const evaluated = evaluateCoa({
    filename,
    product: raw.product ?? null,
    lotNo: raw.lotNo ?? null,
    items: raw.items ?? [],
  });

  // Log ทุก row ที่ evaluate ได้ (รวม SKIP เพื่อ debug ว่าทำไมถูก skip)
  for (const r of evaluated.rows) {
    const min = r.min == null ? "-" : String(r.min);
    const max = r.max == null ? "-" : String(r.max);
    const res = r.result == null ? "-" : String(r.result);
    console.log(
      `  [eval] ${r.status.padEnd(4)} ${truncForLog(r.name, 30).padEnd(30)} min=${min.padEnd(8)} max=${max.padEnd(8)} result=${res.padEnd(8)} ${r.reason}`
    );
  }

  // ช่วง test: เก็บ SKIP ไว้ดูด้วย (เดิม filter ออก) — กลับมา filter ทีหลัง
  return evaluated;
}

function truncForLog(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
