// ★ หัวใจของระบบ ★ — orchestrator 3 ขั้น: extract text → LLM parse → evaluate
// แก้ลำดับขั้น/เปลี่ยน OCR engine/เปลี่ยน LLM service ที่นี่
import * as fs from "fs";
import * as path from "path";
import * as Tesseract from "tesseract.js";
import { PdfService } from "../pdf.service";
import { ImageProcessingService } from "../image-processing.service";
import { OllamaCoaService } from "./ollama-coa.service";
import { RapidOcrService } from "./rapidocr.service";
import { evaluateCoa, summarize, CoaReport } from "./coa-evaluator";
import { extractPdfText } from "./pdf-text-extractor";
import {
  recoverSpecsFromOcr,
  correctSpecDirectionFromOcr,
  applyHeaderDirectionHints,
} from "./spec-recovery";
import { recoverResultsFromOcr } from "./result-recovery";
import { downgradeColumnShiftedResults } from "./column-shift-recovery";
import { recoverSieveTableResults } from "./sieve-table-recovery";
import { extractHeaderDirectionHints } from "./header-direction";
import {
  dropUngroundedItems,
  downgradeUngroundedFails,
  downgradeUngroundedPasses,
} from "./coa-grounding";

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
// คืน engine ที่อ่านสำเร็จด้วย (text-layer/rapidocr/tesseract) → แนบ CoaReport.debug ให้รู้ว่าพังขั้นไหน
export type OcrEngine = "text-layer" | "rapidocr" | "tesseract";
export async function extractText(
  filePath: string
): Promise<{ text: string; engine: OcrEngine }> {
  const ext = path.extname(filePath).toLowerCase();

  // 1. For PDFs: try text layer first — free, no OCR needed if it works
  if (ext === ".pdf") {
    try {
      const { text, hasUsableText } = await extractPdfText(filePath);
      if (hasUsableText) {
        console.log(`  [text-layer] ${text.length} chars`);
        return { text, engine: "text-layer" };
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
    // null = daemon ล่ม/errored · "" หรือ string สั้น = daemon ทำงานแต่ scan โล่ง/คุณภาพต่ำ
    const text = await new RapidOcrService().extractText(imagePath);
    if (text && text.replace(/\s/g, "").length >= 50) {
      console.log(`  [rapidocr] ${text.length} chars`);
      return { text, engine: "rapidocr" };
    }
    // ★ RapidOCR ล้ม → Tesseract fallback ให้ผล "อ่านได้แต่เลขเพี้ยน" (เคยทำ corpus พังเงียบ)
    //   แยกสาเหตุให้ชัด (อย่าโทษ daemon เมื่อ daemon ขึ้นอยู่ — misdirection แบบเดิม):
    //   daemonDown = ติดต่อ daemon ไม่ได้/500 · ไม่ใช่ = daemon อ่านแล้วได้ข้อความน้อย (ไฟล์โล่ง)
    const daemonDown = text == null;
    //   RAPIDOCR_REQUIRED=true → โยน error แทน fallback เงียบๆ (ใช้ตอน validation run กัน garbage ปนผล)
    if (process.env.RAPIDOCR_REQUIRED === "true") {
      throw new Error(
        daemonDown
          ? "RapidOCR daemon unreachable/errored and RAPIDOCR_REQUIRED=true — refusing silent Tesseract fallback. Start it: `npm run ocr:daemon` from backend/."
          : "RapidOCR returned too little text (daemon IS running — scan may be blank/low-quality) and RAPIDOCR_REQUIRED=true — refusing silent Tesseract fallback. Inspect the file."
      );
    }
    console.warn(
      daemonDown
        ? `  [rapidocr] ⚠ daemon FAILED — falling back to Tesseract (numbers may be garbled; check coa-log debug.ocrEngine)`
        : `  [rapidocr] ⚠ thin result (<50 chars, daemon up) — falling back to Tesseract; scan may be low-quality`
    );
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
      return { text: data.text, engine: "tesseract" };
    }
  }
  console.log(
    `  [tesseract] best rotation: ${best.angle}° (conf ${best.confidence.toFixed(1)})`
  );
  return { text: best.text, engine: "tesseract" };
}

// Entry point ของ pipeline — เรียกจากทั้ง HTTP route และ CLI (test-coa.ts)
// คืน CoaReport ที่ evaluate เสร็จแล้ว พร้อม summary PASS/FAIL/SKIP
export async function runCoaPipeline(filePath: string): Promise<CoaReport> {
  const filename = path.basename(filePath);
  const ollama = new OllamaCoaService();

  const { text, engine } = await extractText(filePath);
  dumpDebug("_last-ocr.txt", text);
  if (!text.trim()) {
    return {
      filename,
      product: null,
      lotNo: null,
      rows: [],
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
      debug: { ocrEngine: engine, ocrText: text, llmModel: ollama.modelName, llmRaw: null },
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
      debug: {
        ocrEngine: engine,
        ocrText: text,
        llmModel: ollama.modelName,
        llmRaw: ollama.lastRawResponse,
      },
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

  // กู้ result ที่ LLM หล่นทิ้ง (OCR มีค่าครบ) — เฉพาะ row ที่ result ว่าง + spec มี + เจอ cell ตัวเลข
  //   เดี่ยวตัวเดียวบนบรรทัด row นั้น (ตัด spec/method/unit/ชื่อแล้ว) ★ ไม่ทับของเดิม ★ (เคส ZP10)
  const recRes = recoverResultsFromOcr(raw.items ?? [], text);
  if (recRes.recovered > 0) {
    console.log(`  [result-recovery] เติม result จาก OCR ${recRes.recovered} รายการ`);
  }

  // แก้ทิศ spec ที่ LLM ใส่ผิดช่อง (bare bound) โดยยึด operator ใน OCR (X Max/Min, ≤/≥) — กัน fabricated FAIL
  const fixed = correctSpecDirectionFromOcr(raw.items ?? [], text);
  if (fixed > 0) {
    console.log(`  [spec-direction] แก้ทิศ spec จาก OCR ${fixed} รายการ`);
  }

  // ★ Header-anchored direction (text-layer only) ★ — กู้ทิศ bare-eq จาก "ตำแหน่ง X ของ bound เทียบ
  //   header Min.Spec/Max.Spec" ที่ flat text ทำหาย (Barimite: 0.20 ใต้ Max → ≤0.20, 95 ใต้ Min → ≥95).
  //   ★ post-LLM, อ่าน geometry ดิบจาก PDF ใหม่ — ไม่แตะ text ที่ป้อน LLM → กัน lever-1 regression ★
  //   text-layer เท่านั้น (scan ไม่มี geometry เชื่อถือได้). fail-safe: error/ไม่เจอ header → ปล่อย SKIP เดิม
  if (engine === "text-layer") {
    try {
      const hints = await extractHeaderDirectionHints(filePath);
      const applied = applyHeaderDirectionHints(raw.items ?? [], hints);
      if (applied > 0) {
        console.log(`  [header-direction] กู้ทิศ bare-eq จาก header geometry ${applied} รายการ`);
      }
    } catch (e) {
      console.warn(`  [header-direction] skipped:`, (e as Error).message);
    }
  }

  const evaluated = evaluateCoa({
    filename,
    product: raw.product ?? null,
    lotNo: raw.lotNo ?? null,
    items: raw.items ?? [],
  });

  // ★ Anti-fabricated-FAIL ★ — downgrade FAIL ที่ spec กับ result ไม่อยู่บรรทัด OCR เดียวกัน
  //   (column collapse: spec ถูก broadcast/map ผิดแถวบน scan ตาราง transposed) → SKIP+needsReview
  //   กัน verdict "ของเสีย" จาก spec ที่ไม่ใช่ของแถวนั้นจริง
  const failGuard = downgradeUngroundedFails(evaluated.rows, text);
  if (failGuard.downgraded.length > 0) {
    console.warn(
      `  [fail-guard] downgrade ${failGuard.downgraded.length} FAIL→SKIP (column collapse): ${failGuard.downgraded
        .map((d) => d.name)
        .join(", ")}`
    );
  }

  // ★ Anti-deceptive-PASS ★ — downgrade PASS ที่ spec/result ไม่อยู่บรรทัดชื่อ row เดียวกันใน OCR
  //   (column collapse ฝั่ง PASS: LLM ดึงเลขข้ามแถว → ค่าผิดแต่บังเอิญเข้า spec) → SKIP+needsReview
  //   กัน false-PASS (บาปหนักสุด): บอก "ผ่าน" จาก spec/result ที่ไม่ใช่ของแถวนั้นจริง
  const passGuard = downgradeUngroundedPasses(evaluated.rows, text);
  if (passGuard.downgraded.length > 0) {
    console.warn(
      `  [pass-guard] downgrade ${passGuard.downgraded.length} PASS→SKIP (column collapse): ${passGuard.downgraded
        .map((d) => d.name)
        .join(", ")}`
    );
  }

  // ★ Anti-deceptive (column-shift) ★ — PASS/FAIL ที่ result = คอลัมน์ป้ายซ้ายของ spec (ตาราง
  //   transposed/rotated เช่น RI-015 sieve: LLM เอา aperture เป็น result) → SKIP+needsReview.
  //   ★ downgrade ไม่ overwrite ★ — บนบรรทัดเดียวแยก "ป้าย" กับ "result จริงที่อยู่ซ้าย spec" ไม่ออก →
  //   เลือกเลขหลัง spec มาเป็น result = เสี่ยง deceptive PASS → honest SKIP ปลอดภัยกว่า (review เจอ)
  const colShift = downgradeColumnShiftedResults(evaluated.rows, text);
  if (colShift.downgraded.length > 0) {
    console.warn(
      `  [column-shift] downgrade ${colShift.downgraded.length} → SKIP (result = คอลัมน์ป้าย): ${colShift.downgraded
        .map((d) => `${d.name}(${d.result}|after-spec≈${d.suspectAfterSpec})`)
        .join(", ")}`
    );
  }

  // ★ Sieve/particle-size recovery (gated → PASS) ★ — รันหลัง column-shift (ทำงานบน honest SKIP):
  //   ตาราง sieve ที่ LLM เอา aperture เป็น result → overwrite result จริง (หลัง spec) → re-eval →
  //   promote เฉพาะ PASS, needsReview=true. QUAD GATE: sieve table + ชื่อ row sieve + โครง aperture +
  //   ★ aperture column เป็น series ลดหลั่น ≥3 (positive evidence) ★ — kill deceptive PASS แบบ single-row
  //   ที่ Opus review เจอ. ปิดโมดูล = fall back honest SKIP (ไม่แย่ลง)
  const sieveRec = recoverSieveTableResults(evaluated.rows, text);
  if (sieveRec.recovered.length > 0) {
    console.log(
      `  [sieve-recovery] promote ${sieveRec.recovered.length} → PASS (result หลัง spec): ${sieveRec.recovered
        .map((s) => `${s.name}(${s.from}→${s.to})`)
        .join(", ")}`
    );
  }

  // result ที่กู้มาจาก OCR (result-recovery): ถ้ายังเป็น PASS/FAIL → ตั้ง needsReview (อย่าให้ verdict
  //   จากค่าที่เติมเองเงียบ ๆ มั่นใจ — กันเคส OCR มีเลข stray ตัวเดียวบนบรรทัดแล้วถูกหยิบเป็น result)
  if (recRes.names.length > 0) {
    const recSet = new Set(recRes.names.map((n) => n.trim()));
    for (const r of evaluated.rows) {
      if (recSet.has(r.name.trim()) && r.status !== "SKIP") r.needsReview = true;
    }
  }

  // re-summarize ครั้งเดียวหลัง guard ทุกตัว (fail + pass + column-shift) แก้ status เสร็จ
  if (
    failGuard.downgraded.length > 0 ||
    passGuard.downgraded.length > 0 ||
    colShift.downgraded.length > 0 ||
    sieveRec.recovered.length > 0
  ) {
    evaluated.summary = summarize(evaluated.rows);
  }

  // แนบหลักฐานดิบ — เปิด coa-log JSON ดูได้ว่า OCR อ่านอะไร vs LLM parse อะไร (พังที่ model ไหน)
  evaluated.debug = {
    ocrEngine: engine,
    ocrText: text,
    llmModel: ollama.modelName,
    llmRaw: ollama.lastRawResponse,
  };

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
