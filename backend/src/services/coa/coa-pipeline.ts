// ★ หัวใจของระบบ ★ — orchestrator 3 ขั้น: extract text → LLM parse → evaluate
// แก้ลำดับขั้น/เปลี่ยน OCR engine/เปลี่ยน LLM service ที่นี่
import * as fs from "fs";
import * as path from "path";
import * as Tesseract from "tesseract.js";
import { PdfService } from "../pdf.service";
import { ImageProcessingService } from "../image-processing.service";
import { OllamaCoaService, RawCoa } from "./ollama-coa.service";
import { RapidOcrService, OcrToken } from "./rapidocr.service";
import { buildScannedGrid, VectorGeom } from "./scanned-grid-builder";
import { evaluateCoa, summarize, CoaReport, EvaluatedItem } from "./coa-evaluator";
import { extractPdfText, extractPdfTextPerPage } from "./pdf-text-extractor";
import { extractPdfGridPerPage } from "./pdf-grid-extractor";
import { parseStructuralGrid, GridOrient } from "./parse-structural-grid";
import {
  recoverSpecsFromOcr,
  correctSpecDirectionFromOcr,
  applyHeaderDirectionHints,
} from "./spec-recovery";
import { recoverResultsFromOcr } from "./result-recovery";
import { recoverAverageColumn } from "./avg-column-recovery";
import { recoverSpecificationColumn } from "./spec-column-recovery";
import { downgradeColumnShiftedResults } from "./column-shift-recovery";
import { recoverSieveTableResults } from "./sieve-table-recovery";
import { extractHeaderDirectionHints } from "./header-direction";
import {
  dropUngroundedItems,
  downgradeUngroundedFails,
  downgradeUngroundedPasses,
  downgradeOcrOutlierFails,
  FailGuardResult,
  PassGuardResult,
} from "./coa-grounding";
import { filterMetadataRows } from "./metadata-row-filter";

// ★ grid→LLM (column-aware OCR text → LLM; keep-best) ★
//   column band จาก token bbox เก็บ cell ว่าง → LLM map spec/result ไม่เลื่อน (เคส column-shift เช่น SODA/PR1950W)
//   ★ ใช้แบบ keep-best (ดู processPage): flat เป็น floor เสมอ, grid challenger เก็บเฉพาะตอนชนะขาด → 0 regress ★
//   ★ guard ทุกตัวกิน flat text (debug.ocrText) เสมอ — grid ป้อน LLM อย่างเดียว ★
//   rapidocr engine เท่านั้น (text-layer/tesseract ไม่มี token bbox ที่เชื่อถือได้)
//   toggle: COA_GRID_LLM=false ปิด grid challenger (กลับ flat ล้วน). default เปิด
const GRID_LLM_ENABLED = process.env.COA_GRID_LLM !== "false";

// ★ avg-column recovery toggle ★ — ดึงคอลัมน์ Average/Mean เป็น result (deterministic). default เปิด
//   COA_AVG_COLUMN=false ปิด (กลับไปใช้ result ที่ LLM อ่าน). ใช้ A/B baseline vs after
const AVG_COLUMN_ENABLED = process.env.COA_AVG_COLUMN !== "false";

// ★ spec-column recovery toggle ★ — DuPont "double Min/Max": correct the Specification range from grid
//   geometry (deterministic, header-anchored). default เปิด. COA_SPEC_COLUMN=false ปิด (กลับไป LLM spec)
const SPEC_COLUMN_ENABLED = process.env.COA_SPEC_COLUMN !== "false";

// grid provenance — how the column-aware gridText was recovered:
//   "structural" = pdfplumber ruling-line geometry (text-layer PDFs) → columns verified by real geometry.
//                  grid-won PASS may go clean-green when the value sits mid-range of a two-sided spec
//                  (balanced amber) — geometry confirms the column, so a between-spec value is trustworthy.
//   "spatial"    = rapidocr token-bbox clustering (scanned) → columns INFERRED, not verified.
//                  grid-won PASS stays amber ("ต้องตรวจ") always — can't prove the column mapping.
//   ★ this distinction is the anti-deceptive lever: never let an inferred-column PASS show clean-green ★
type GridSource = "structural" | "spatial" | "scanned-vector";
type PageExtract = {
  text: string;
  engine: OcrEngine;
  page: number;
  gridText?: string;
  gridSource?: GridSource;
  gridOrient?: GridOrient; // pdf_table.py orientation (transposed COAs already rotated to rows)
  tokens?: OcrToken[];           // RapidOCR tokens (for scanned-vector grid building)
  correctionAngle?: number;      // 0 if upright, 90/270 if rotation-corrected
  imagePath?: string;            // rendered image path (for scanned pages — needed for imageWidth)
};

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

// OCR portion only — รับ path รูปที่ render ไว้แล้ว คืน {text, engine}
// (RapidOCR sidecar + Tesseract multi-rotation fallback — logic เดิมทั้งหมด)
async function ocrImage(
  imagePath: string
): Promise<{ text: string; engine: OcrEngine; gridText?: string; tokens?: OcrToken[]; correctionAngle?: number }> {
  // 2. RapidOCR sidecar (primary OCR) — Python daemon, แม่นกว่า Tesseract มากบนตาราง COA scan
  //    ต้อง start daemon ก่อน: `npm run ocr:daemon` (หรือ ocr-py/ocr_server.py). ปิดด้วย USE_RAPIDOCR=false
  //    daemon ล่ม/unreachable → คืน null → fall through ไป Tesseract อัตโนมัติ
  if (process.env.USE_RAPIDOCR !== "false") {
    console.log(`  [rapidocr] OCR via sidecar…`);
    // null = daemon ล่ม/errored · "" หรือ string สั้น = daemon ทำงานแต่ scan โล่ง/คุณภาพต่ำ
    // extractTextBoth: OCR pass เดียว คืน flat (guard) + grid (LLM) — ไม่ OCR ซ้ำ
    const both = await new RapidOcrService().extractTextBoth(imagePath);
    const text = both?.flat ?? null;
    if (text && text.replace(/\s/g, "").length >= 50) {
      console.log(`  [rapidocr] ${text.length} chars`);
      // grid (column-aware) ป้อน LLM เฉพาะเมื่อเปิด flag — guard ยังใช้ flat (text) เสมอ
      const gridText = GRID_LLM_ENABLED ? both?.grid : undefined;
      return { text, engine: "rapidocr", gridText, tokens: both.tokens, correctionAngle: both.correctionAngle };
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

// Extract text per page — คืน array [{text, engine, page}] หนึ่งตัวต่อหน้า
// image file (png/jpg) → คืน 1 entry, page=1
// pdf → ลอง text-layer ต่อหน้า; หน้าที่ไม่มี usable text → render + OCR
async function extractTextPerPage(
  filePath: string
): Promise<PageExtract[]> {
  const ext = path.extname(filePath).toLowerCase();

  // ไฟล์รูป → OCR เดียว, page=1
  if (ext !== ".pdf") {
    const result = await ocrImage(filePath);
    return [
      { ...result, page: 1, gridSource: result.gridText ? "spatial" : undefined, imagePath: filePath },
    ];
  }

  // PDF: ลอง text-layer ต่อหน้าก่อน
  let pages: { text: string; hasUsableText: boolean }[] = [];
  try {
    const extracted = await extractPdfTextPerPage(filePath);
    pages = extracted.pages;
  } catch (e) {
    console.warn(`  [text-layer] extractPdfTextPerPage failed:`, (e as Error).message);
    pages = []; // fallback: ถือว่าทุกหน้าต้อง OCR
  }

  // ตรวจว่ามีหน้าไหนต้องการ render+OCR บ้าง
  const needRender = pages.length === 0 || pages.some((p) => !p.hasUsableText);

  let imgs: string[] = [];
  if (needRender) {
    imgs = await new PdfService().convertToImage(filePath);
  }

  // ถ้า extractPdfTextPerPage ล้มทั้งหมด → OCR ทุก rendered page
  if (pages.length === 0) {
    const results: PageExtract[] = [];
    for (let i = 0; i < imgs.length; i++) {
      const ocr = await ocrImage(imgs[i]);
      results.push({
        ...ocr,
        page: i + 1,
        gridSource: ocr.gridText ? "spatial" : undefined,
        imagePath: imgs[i],
      });
    }
    return results;
  }

  // มี text-layer data: ต่อหน้าดูว่า hasUsableText หรือเปล่า
  // ★ page alignment: imgs (convertToImage) กับ pages (extractPdfTextPerPage) วน p=1..numPages
  //   บน doc เดียวกัน → ต้องยาวเท่ากันเสมอ. ไม่เท่า = สมมุติฐาน page-index พัง → warn ดังๆ
  //   (อย่า OCR หน้าผิดแล้วป้ายเป็นหน้าอื่นเงียบๆ = deceptive result)
  if (needRender && imgs.length !== pages.length) {
    console.warn(
      `  [extract] ⚠ page-count mismatch: text-layer ${pages.length} vs rendered ${imgs.length} — page alignment unreliable`
    );
  }
  const results: PageExtract[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    if (pg.hasUsableText) {
      console.log(`  [text-layer] page ${i + 1}: ${pg.text.length} chars`);
      results.push({ text: pg.text, engine: "text-layer", page: i + 1 });
    } else {
      console.log(`  [text-layer] page ${i + 1}: empty/scanned — falling back to OCR`);
      const imgPath = imgs[i];
      // ★ ไม่มี rendered image ตรง index → throw แทน fallback เงียบ (กัน OCR หน้าผิดแล้วป้ายเป็นหน้า i+1)
      if (!imgPath) {
        throw new Error(
          `No rendered image for page ${i + 1} (rendered ${imgs.length} of ${pages.length} pages) — refusing to OCR a misaligned page`
        );
      }
      const ocr = await ocrImage(imgPath);
      results.push({
        ...ocr,
        page: i + 1,
        gridSource: ocr.gridText ? "spatial" : undefined,
        imagePath: imgPath,
      });
    }
  }

  // ★ structural grid (text-layer root fix) ★ — recover the true 2D cell-grid from the PDF's
  //   ruling lines via pdfplumber (no torch) and attach as gridText to text-layer pages. flatten
  //   throws away column geometry (transposed COAs, over-flagging) — this restores it. keep-best
  //   in processPage decides if it actually wins; flat stays the floor → 0 regression.
  //   gridSource="structural" = columns verified by real geometry (vs rapidocr "spatial" = inferred).
  if (GRID_LLM_ENABLED && results.some((r) => r.engine === "text-layer")) {
    const grids = extractPdfGridPerPage(filePath);
    const gridByPage = new Map(grids.map((g) => [g.page, g]));
    for (const r of results) {
      if (r.engine !== "text-layer") continue;
      const g = gridByPage.get(r.page);
      if (g && g.source !== "none" && g.grid.trim()) {
        r.gridText = g.grid;
        r.gridSource = "structural";
        r.gridOrient = g.orient ?? "normal";
        console.log(
          `  [pdf-grid] page ${r.page}: structural grid (${g.source}, ${g.orient ?? "normal"}, ${g.grid.length} chars)`
        );
      }
    }
  }

  // ★ scanned-vector grid (Track 2) ★ — for scanned PDFs with pdfplumber vector ruling-line geometry.
  //   Maps RapidOCR tokens into geometry-verified columns → gridSource="scanned-vector" →
  //   deterministic parseStructuralGrid (no LLM). Only SODA/PR1950W_4063-class PDFs qualify
  //   (chars=0 but vector rects). 7 pure-raster scanned files stay spatial (no rects → no geom).
  //   THREE BLOCKERS: (1) correctionAngle≠0 (2) pageRotation≠0 (3) colEdges.length<4
  if (GRID_LLM_ENABLED && results.some((r) => r.engine === "rapidocr" && r.tokens?.length)) {
    const svGrids = extractPdfGridPerPage(filePath);
    const svByPage = new Map(svGrids.map((g) => [g.page, g]));
    const proc = new ImageProcessingService();
    for (const r of results) {
      if (r.engine !== "rapidocr" || !r.tokens?.length || !r.imagePath) continue;
      const g = svByPage.get(r.page);
      if (!g || g.source !== "vector-geom" || !g.colEdges?.length) continue;
      let imgW: number;
      try {
        const meta = await proc.metadata(r.imagePath);
        imgW = meta.width ?? 0;
        if (!imgW) continue;
      } catch {
        continue;
      }
      const geom: VectorGeom = {
        colEdges: g.colEdges!,
        pageWidth: g.pageWidth!,
        pageHeight: g.pageHeight!,
        pageRotation: g.pageRotation ?? 0,
        tableBbox: g.tableBbox!,
      };
      const grid = buildScannedGrid(r.tokens, geom, imgW, r.correctionAngle ?? 0);
      if (!grid) continue;
      r.gridText = grid;
      r.gridSource = "scanned-vector";
      r.gridOrient = "normal";
      console.log(
        `  [scanned-vector] page ${r.page}: geometry-verified grid (${g.colEdges!.length - 1} cols, ${grid.length} chars)`
      );
    }
  }

  return results;
}

// ───────── keep-best: flat ก่อนเสมอ · ลอง grid เฉพาะไฟล์ที่ flat อาการ column-collapse · เก็บ grid เฉพาะตอนชนะขาด ─────────

// "flat โชว์อาการ column-collapse" = มี SKIP ที่ guard ดาวน์เกรดเพราะ collapse.
//   ★ จับจาก keyword ในข้อความ reason (ภาษาคน) ★: "สลับ" (อ่านสลับคอลัมน์/แถว/ค่าผล↔เกณฑ์ = column-shift,
//   fail-downgrade, bare-eq copy) · "ทิศหาย" (bare-eq เกณฑ์เลขเดี่ยวไม่มีทิศ). ★★ ถ้าแก้ wording reason
//   ต้องคงคำเหล่านี้ไว้ ไม่งั้น grid challenger ไม่ยิง = SODA/PR1950W regress ★★
//   ไฟล์ flat ดีอยู่แล้ว (ZP10 4P/0S · RI-015 collapse ถูก sieve-recovery promote หมด) → ไม่มี collapse-SKIP →
//   ไม่ trigger grid → ไม่เสีย LLM call เปล่า. = ตัวกรองให้ grid challenger ยิงเฉพาะไฟล์ column-shift จริง (SODA/PR1950W)
const COLLAPSE_SKIP_RE = /สลับ|ทิศหาย/;
function hasCollapseSymptom(rpt: CoaReport): boolean {
  return rpt.rows.some((r) => r.status === "SKIP" && COLLAPSE_SKIP_RE.test(r.reason ?? ""));
}

const passCount = (rpt: CoaReport): number =>
  rpt.rows.filter((r) => r.status === "PASS").length;

// ★ multiset: นับ PASS ต่อชื่อ row (ไม่ใช่ Set) — ตาราง sieve มีชื่อซ้ำได้ (RI-015 "Particle Size" ×4)
//   Set เดิมยุบชื่อซ้ำเหลือ 1 → superset check เพี้ยน → grid อาจทิ้ง flat PASS เงียบ. multiset กันได้
function passNameCounts(rpt: CoaReport): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rpt.rows) {
    if (r.status !== "PASS") continue;
    // ยุบ whitespace ทั้งหมด: flat/structural สะกดชื่อเว้นวรรคต่างกัน ("Ba SO4"="BaSO4","D 100"="D100")
    const k = r.name.replace(/\s+/g, "").toLowerCase();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// identity ของ PASS row (name + spec + result + verdict) — ใช้เช็คว่า grid PASS "ตรงกับ" flat PASS ไหม
//   ★ ไม่ตรง (row ใหม่ หรือค่า/spec เปลี่ยน) = flat ยืนยันไม่ได้ → grid ต้อง needsReview (ดู processPage) ★
function passKey(r: EvaluatedItem): string {
  return [
    r.name.trim().toLowerCase(),
    r.min ?? "",
    r.max ?? "",
    r.specRaw ?? "",
    r.result ?? "",
  ].join("|");
}

// ★ keep-best gate (anti-regression) ★ — เก็บ grid เฉพาะเมื่อครบ 3:
//   (1) grid ไม่สร้าง FAIL (2) grid PASS count ต่อชื่อ ≥ flat ทุกชื่อ (multiset — ห้ามทำ PASS ดีหาย แม้ชื่อซ้ำ)
//   (3) grid เพิ่ม PASS รวม. ไม่ครบ → คง flat → 0 regression. (ZP10: grid 1P < flat 4P → คง flat)
function gridBeatsFlat(grid: CoaReport, flat: CoaReport): boolean {
  if (grid.summary.fail > 0) return false;
  const gc = passNameCounts(grid);
  const fc = passNameCounts(flat);
  for (const [name, fn] of fc) {
    if ((gc.get(name) ?? 0) < fn) return false; // grid ต้องเก็บ PASS เดิมของ flat ครบ (ต่อชื่อ)
  }
  return passCount(grid) > passCount(flat);
}

// ★ Balanced amber policy — "ปลอดภัยพอจะปล่อย clean-green ไหม" (Opus-reviewed) ★
//   ปล่อย clean-green เฉพาะ spec แบบ **ช่วง 2 ด้าน (between min+max)** ที่ค่าอยู่ "กลางช่วง" ห่างขอบ.
//   ★ one-sided (≤max / ≥min) → amber เสมอ ★ — recovery หยิบเลข stray บนบรรทัดได้ ถ้าเป็น ≥min เลขใหญ่ๆ
//     ผ่านสบาย = อาจ hide FAIL (เลขจริงตก spec แต่ stray ผ่าน). between บังคับให้ stray ต้องตกในช่วง = เสี่ยงน้อยกว่า.
//   ★ ช่วงยุบ (span ≈ 0, eq-like) → amber ★ — กัน band ยุบเป็น 0 แล้วเข้าใจผิดว่า "ห่างขอบ".
//   อ่านค่าไม่ได้ / ไม่ใช่ช่วง 2 ด้าน → true (amber). near = ภายใน 5% ของความกว้างช่วง.
const REL_TOL = 0.05;
const VALUE_MARGIN_M = 0.30; // margin-green gate: result must be ≥30% of |result| away from the binding spec bound
function isNearSpecBoundary(r: EvaluatedItem): boolean {
  const res = typeof r.result === "number" ? r.result : Number(r.result);
  if (!Number.isFinite(res)) return true;
  if (r.min == null || r.max == null) return true; // ไม่ใช่ช่วง 2 ด้าน → ไม่ปล่อย clean-green
  const span = r.max - r.min;
  if (span <= Math.abs(res) * 1e-3) return true;   // ช่วงยุบ (≈eq) → ทุกค่าถือว่าใกล้ขอบ
  const band = span * REL_TOL;
  return res <= r.min + band || res >= r.max - band;
}

// ★ Margin-green policy (Track 2 + scanned-vector) ★ — CLEAR-ONLY: sets needsReview=false on PASS
//   rows that are safely away from spec bounds. Never sets needsReview=true (only guards do that).
//   Five gates must ALL pass:
//   G0 column-trust allow-list: structural | scanned-vector | text-layer flat (never spatial)
//   G1 status=PASS
//   G2 margin = clearance/|result| >= VALUE_MARGIN_M
//   G3' integer decimal-shift guard (both directions, mirrors detectDecimalRisk)
//   G4 decimal-present: if binding bound is fractional, resultRaw must contain a decimal point
function applyMarginGreen(
  rows: EvaluatedItem[],
  engine: OcrEngine,
  gridSource: GridSource | undefined
): void {
  // G0: allow-list — "spatial" columns are inferred, never trust for clean-green
  const colTrusted =
    gridSource === "structural" ||
    gridSource === "scanned-vector" ||
    (engine === "text-layer" && gridSource == null);
  if (!colTrusted) return;

  for (const r of rows) {
    // Only clear amber flags (skip rows that are already clean-green or not PASS)
    if (!r.needsReview || r.status !== "PASS") continue;

    const res = r.result;
    if (res == null || !Number.isFinite(res) || res === 0) continue; // G2 needs finite nonzero result

    // Determine clearance and binding bound based on spec operator
    let clearance: number;
    let bindingBound: number | null;
    if (r.min != null && r.max != null) {
      // between: clearance = distance to nearer bound
      clearance = Math.min(Math.abs(res - r.min), Math.abs(r.max - res));
      bindingBound = Math.abs(res - r.min) <= Math.abs(r.max - res) ? r.min : r.max;
    } else if (r.max != null) {
      // le/lt: clearance = max - result
      clearance = r.max - res;
      bindingBound = r.max;
    } else if (r.min != null) {
      // ge/gt: clearance = result - min
      clearance = res - r.min;
      bindingBound = r.min;
    } else {
      continue; // no bound to compute margin against
    }

    // G2: margin gate
    if (clearance / Math.abs(res) < VALUE_MARGIN_M) continue;

    // G3': integer decimal-shift guard (both directions)
    // If result is an integer, check if multiplying/dividing by 10/100 changes spec satisfaction
    if (Number.isInteger(res)) {
      const alts = [res / 10, res * 10, res / 100, res * 100];
      const baseline = specContainsResult(r); // does current result satisfy spec?
      let riskFound = false;
      for (const alt of alts) {
        if (specContainsResult({ ...r, result: alt }) !== baseline) {
          riskFound = true;
          break;
        }
      }
      if (riskFound) continue;
    }

    // G4: decimal-present guard
    // If binding bound is fractional, the result raw must also contain a decimal point
    if (bindingBound != null && !Number.isInteger(bindingBound)) {
      const raw = r.resultRaw ?? "";
      if (!/\./.test(raw)) continue;
    }

    // All gates passed — clear the amber flag
    r.needsReview = false;
  }
}

// Helper for G3': check if a result value satisfies the spec bounds on this row
function specContainsResult(r: { result: number | null; min: number | null; max: number | null }): boolean {
  const v = r.result;
  if (v == null) return false;
  if (r.min != null && r.max != null) return v >= r.min && v <= r.max;
  if (r.max != null) return v <= r.max;
  if (r.min != null) return v >= r.min;
  return false;
}

// runExtractionPass — 1 รอบ extract+guard. ★ LLM อ่าน llmInput · guard ทุกตัวอ่าน text (flat) เสมอ ★ (dual-text)
//   factored เพื่อ keep-best — เรียก 2 variant: flat (llmInput=text) · grid (llmInput=gridText, text เดิม)
//   เรียกเมื่อ text ไม่ว่างเท่านั้น (processPage เช็คก่อน). variant = label log. debug.ocrText = text (flat) เสมอ
async function runExtractionPass(
  filename: string,
  filePath: string,
  llmInput: string,
  text: string,
  engine: OcrEngine,
  page: number,
  ollama: OllamaCoaService,
  variant: string,
  gridSource?: GridSource,
  gridOrient?: GridOrient,
  avgGrid?: string
): Promise<CoaReport> {
  // ★ structural/scanned-vector grid → parse แบบ deterministic (ไม่ใช้ LLM) ★ คอลัมน์ยืนยันด้วย geometry
  //   ใช้: เดิน parse path นี้ · ข้าม flat-text guard (เทียบ text ผิด→false downgrade) · promote boundary · gate ด้วย keep-best
  const isDeterministicGrid =
    variant === "grid" && (gridSource === "structural" || gridSource === "scanned-vector");

  let raw: RawCoa | null;
  let llmModelLabel: string;
  let llmRawLabel: string | null;
  if (isDeterministicGrid) {
    console.log(`  [grid-parser] parsing (deterministic ${gridSource ?? "structural"}, ${gridOrient ?? "normal"})…`);
    raw = parseStructuralGrid(llmInput, gridOrient ?? "normal");
    llmModelLabel = "deterministic-grid-parser";
    llmRawLabel = JSON.stringify(raw, null, 2);
    console.log(`  [grid-parser] parsed ${raw.items?.length ?? 0} items (${gridSource ?? "structural"})`);
  } else {
    console.log(`  [ollama] parsing (${variant})…`);
    raw = await ollama.parseCoa(llmInput);
    llmModelLabel = ollama.modelName;
    llmRawLabel = ollama.lastRawResponse;
  }
  if (!raw) {
    console.log(`  [ollama] parse failed / no items (${variant})`);
    return {
      filename,
      product: null,
      lotNo: null,
      page,
      rows: [],
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
      debug: {
        ocrEngine: engine,
        ocrText: text,
        llmModel: llmModelLabel,
        llmRaw: llmRawLabel,
      },
    };
  }
  // deterministic path already logged its count; only the LLM path needs the parsed-count line here
  if (!isDeterministicGrid) {
    console.log(`  [ollama] parsed ${raw.items?.length ?? 0} items (${variant})`);
  }

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

  // ตัด metadata rows ที่ LLM ดึงมาเป็น item ทั้งที่ไม่ใช่รายการทดสอบ (Lot number/Production Date/ACCEPT/Item header)
  // ต้องครบ 2 เงื่อนไข: (a) ชื่อ match pattern metadata + (b) ไม่มี spec จริง — conservative เพื่อไม่ตัดของจริง
  const metaFilter = filterMetadataRows(raw.items ?? []);
  if (metaFilter.dropped.length > 0) {
    console.log(
      `  [metadata-filter] ตัด ${metaFilter.dropped.length} junk metadata row: ${metaFilter.dropped
        .map((d) => d.name ?? "(unnamed)")
        .join(", ")}`
    );
    raw.items = metaFilter.kept;
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

  // ★ Average/Mean-column recovery (deterministic, column-aware grid) ★ — บาง COA ลงค่าวัดหลายตัวแล้ว
  //   ตามด้วยคอลัมน์ Average; spec เทียบกับ "ค่าเฉลี่ย" ไม่ใช่ค่าวัดเดี่ยว. qwen3:4b บางรันหยิบค่าวัดตัวเดียว
  //   (Lot240521 150μ: หยิบ 58 ทั้งที่ค่าเฉลี่ยจริง 56.0) → override result จาก band คอลัมน์ Average.
  //   ★ ABSTAIN ถ้าไม่เจอ header "Average/Mean" ที่ชัด → ไฟล์ที่ไม่มีคอลัมน์นี้ไม่ถูกแตะ (no-op) ★
  //   รันหลัง result-recovery (avg = ค่าทางการ ทับค่าวัดเดี่ยวที่เพิ่งเติมได้)
  const avgOverridden = new Set<string>();
  if (AVG_COLUMN_ENABLED && avgGrid && avgGrid.trim()) {
    const avg = recoverAverageColumn(raw.items ?? [], avgGrid);
    for (const o of avg.overridden) avgOverridden.add(o.name.trim());
    if (avg.overridden.length > 0) {
      console.log(
        `  [avg-column] override result จากคอลัมน์ Average ${avg.overridden.length} รายการ: ${avg.overridden
          .map((o) => `${o.name}(${o.from ?? "∅"}→${o.to})`)
          .join(", ")}`
      );
    }
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
      const hints = await extractHeaderDirectionHints(filePath, page);
      const applied = applyHeaderDirectionHints(raw.items ?? [], hints);
      if (applied > 0) {
        console.log(`  [header-direction] กู้ทิศ bare-eq จาก header geometry ${applied} รายการ`);
      }
    } catch (e) {
      console.warn(`  [header-direction] skipped:`, (e as Error).message);
    }
  }

  // ★ Specification-column recovery (DuPont double Min/Max) ★ — runs LAST before eval so no later pass
  //   overrides the corrected spec. Header-anchored: picks the rightmost (Specification) Min/Max pair,
  //   rejects OCR-mangled cells, asserts only on ≥2-block agreement. ABSTAINS off-layout (no-op).
  //   ★ flag EVERY detected DuPont row needsReview (spatial = inferred columns) — corrected or not ★
  const specDupontNames = new Set<string>();
  if (SPEC_COLUMN_ENABLED && avgGrid && avgGrid.trim()) {
    const spec = recoverSpecificationColumn(raw.items ?? [], avgGrid);
    for (const n of spec.dupontNames) specDupontNames.add(n.trim());
    if (spec.overridden.length > 0) {
      console.log(
        `  [spec-column] แก้ spec จากคอลัมน์ Specification ${spec.overridden.length} รายการ: ${spec.overridden
          .map((o) => `${o.name}(${o.from}→${o.to})`)
          .join(", ")}`
      );
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
  const failGuard: FailGuardResult = isDeterministicGrid
    ? { downgraded: [] }
    : downgradeUngroundedFails(evaluated.rows, text);
  if (failGuard.downgraded.length > 0) {
    console.warn(
      `  [fail-guard] downgrade ${failGuard.downgraded.length} FAIL→SKIP (column collapse): ${failGuard.downgraded
        .map((d) => d.name)
        .join(", ")}`
    );
  }

  // ★ OCR digit-scramble outlier ★ — downgrade FAIL ที่ result > specMax×100 (OCR เลขเพี้ยนรุนแรง)
  //   co-location ยังผ่านแต่ result ห่างจาก spec ผิดปกติ เช่น 1F1710 Fiber Length: "1.090"→"0601"→601
  const outlierGuard = downgradeOcrOutlierFails(evaluated.rows);
  if (outlierGuard.downgraded.length > 0) {
    console.warn(
      `  [outlier-guard] downgrade ${outlierGuard.downgraded.length} FAIL→SKIP (digit-scramble): ${outlierGuard.downgraded
        .map((d) => d.name)
        .join(", ")}`
    );
  }

  // ★ Anti-deceptive-PASS ★ — downgrade PASS ที่ spec/result ไม่อยู่บรรทัดชื่อ row เดียวกันใน OCR
  //   (column collapse ฝั่ง PASS: LLM ดึงเลขข้ามแถว → ค่าผิดแต่บังเอิญเข้า spec) → SKIP+needsReview
  //   กัน false-PASS (บาปหนักสุด): บอก "ผ่าน" จาก spec/result ที่ไม่ใช่ของแถวนั้นจริง
  const passGuard: PassGuardResult = isDeterministicGrid
    ? { downgraded: [] }
    : downgradeUngroundedPasses(evaluated.rows, text);
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
  const colShift: ReturnType<typeof downgradeColumnShiftedResults> = isDeterministicGrid
    ? { downgraded: [] }
    : downgradeColumnShiftedResults(evaluated.rows, text);
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

  // ★ promote boundary-exact (เฉพาะ grid ที่ geometry ยืนยัน) ★ — evaluateCoa downgrade PASS ที่ result ตรงขอบ spec พอดี
  //   (กัน LLM ปลอม) แต่ที่นี่ bound มาจากคอลัมน์ Lower/Upper จริง = PASS แท้ · promote SKIP→PASS คง needsReview · เฉพาะ min≠max
  let boundaryPromoted = 0;
  if (isDeterministicGrid) {
    for (const r of evaluated.rows) {
      if (r.status !== "SKIP" || r.min == null || r.max == null || r.min === r.max) continue;
      const res = typeof r.result === "number" ? r.result : Number(r.result);
      if (!Number.isFinite(res)) continue;
      if (res >= r.min && res <= r.max && (res === r.min || res === r.max)) {
        r.status = "PASS";
        r.needsReview = true;
        r.reason = "ค่าผลตรงขอบเกณฑ์พอดี (คอลัมน์ยืนยันด้วย geometry) — ผ่าน แต่ควรเหลือบดู";
        boundaryPromoted++;
      }
    }
    if (boundaryPromoted > 0) {
      console.log(
        `  [boundary-promote] promote ${boundaryPromoted} SKIP→PASS (geometry-verified boundary-exact)`
      );
    }
  }

  // result ที่กู้มาจาก OCR (result-recovery) → ★ Balanced amber policy ★
  //   recovery มี precondition แน่นอยู่แล้ว (เจอ cell เลขเดี่ยว unique บนบรรทัด anchor unique = โครงชัด).
  //   เดิม flag needsReview ทุกตัว → คนหน้างานต้องตรวจซ้ำหมด = ไม่ลดงาน. ปรับเป็น:
  //   • ค่าเข้า spec ห่างขอบ → ปล่อย PASS เขียว (recovery ผิดก็ไม่พลิก verdict + ค่าตรง OCR)
  //   • ค่าใกล้ขอบ spec (isNearSpecBoundary) → คง amber (recovery ผิดนิดเดียวพลิก PASS↔FAIL = เสี่ยงจริง)
  //   ★ column-remap (grid-won / sieve-recovery) flag แยกที่อื่น (re-read ทั้งคอลัมน์ = เสี่ยงกว่า คง amber เสมอ) ★
  if (recRes.names.length > 0) {
    const recSet = new Set(recRes.names.map((n) => n.trim()));
    for (const r of evaluated.rows) {
      if (!recSet.has(r.name.trim()) || r.status === "SKIP") continue;
      if (isNearSpecBoundary(r)) r.needsReview = true;
    }
  }

  // ★ avg-column override → balanced policy (spatial + structural) ★ — override = re-read "cell เดียว"
  //   จากคอลัมน์ Average (ไม่ใช่ทั้งคอลัมน์) → เสี่ยงต่ำ. ค่ากลางช่วง → green (override ผิดก็ไม่พลิก verdict)
  //   · ใกล้ขอบ spec → amber (พลิก PASS↔FAIL ง่าย). ★ ต่างจาก grid keep-best (re-read ทั้งคอลัมน์ =
  //   เสี่ยงกว่า) ที่ spatial ยังคง amber เสมอ ★
  if (avgOverridden.size > 0) {
    for (const r of evaluated.rows) {
      if (!avgOverridden.has(r.name.trim()) || r.status !== "PASS") continue;
      if (isNearSpecBoundary(r)) r.needsReview = true;
    }
  }

  // ★ spec-column (DuPont) → surface ALL detected rows ★ — the spec was re-sourced from an inferred
  //   (spatial) grid; even a corrected/unchanged spec must be human-verified, never silent clean-green.
  if (specDupontNames.size > 0) {
    for (const r of evaluated.rows) {
      if (specDupontNames.has(r.name.trim()) && r.status === "PASS") r.needsReview = true;
    }
  }

  // re-summarize ครั้งเดียวหลัง guard ทุกตัว (fail + pass + column-shift + outlier) แก้ status เสร็จ
  if (
    failGuard.downgraded.length > 0 ||
    outlierGuard.downgraded.length > 0 ||
    passGuard.downgraded.length > 0 ||
    colShift.downgraded.length > 0 ||
    sieveRec.recovered.length > 0 ||
    boundaryPromoted > 0
  ) {
    evaluated.summary = summarize(evaluated.rows);
  }

  // ★ Margin-green: clear amber on rows that pass value-trust gate (G0-G4) ★
  //   CLEAR-ONLY — never sets needsReview=true; purely additive to existing flags.
  applyMarginGreen(evaluated.rows, engine, gridSource);

  // แนบหลักฐานดิบ — เปิด coa-log JSON ดูได้ว่า OCR อ่านอะไร vs parser/LLM parse อะไร (พังที่ขั้นไหน)
  evaluated.debug = {
    ocrEngine: engine,
    ocrText: text,
    llmModel: llmModelLabel,
    llmRaw: llmRawLabel,
  };

  // set page number on the report
  evaluated.page = page;

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

// runFlatGridBest — keep-best ของ OCR text ชุดเดียว: flat floor + grid challenger
//   flat ก่อนเสมอ (= floor, พฤติกรรมเดิม) · ถ้า flat โชว์ collapse-SKIP + มี gridText → ลอง grid challenger
//   เก็บ grid เฉพาะเมื่อชนะ flat ขาด (เพิ่ม PASS, ไม่ลด PASS เดิม, 0 FAIL) → ไม่งั้นคง flat
//   ★ anti-regression by construction: flat เป็น floor เสมอ — grid ทำให้ดีขึ้นได้ ทำให้แย่ลงไม่ได้ ★
async function runFlatGridBest(
  filename: string,
  filePath: string,
  text: string,
  engine: OcrEngine,
  page: number,
  gridText?: string,
  gridSource?: GridSource,
  gridOrient?: GridOrient
): Promise<CoaReport> {
  if (!text.trim()) {
    return {
      filename,
      product: null,
      lotNo: null,
      page,
      rows: [],
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
      debug: {
        ocrEngine: engine,
        ocrText: text,
        llmModel: new OllamaCoaService().modelName,
        llmRaw: null,
      },
    };
  }

  // 1) flat variant — รันเสมอ (floor, พฤติกรรมเดิมเป๊ะ)
  //    ★ ส่ง gridText ให้ avg-column recovery (deterministic, abstain ถ้าไม่มี header Average) ★
  //    gridSource ใช้กำหนด needsReview policy ของ avg-override (spatial=amber, structural=balanced)
  const flatReport = await runExtractionPass(
    filename, filePath, text, text, engine, page, new OllamaCoaService(), "flat",
    gridSource, gridOrient, gridText
  );

  // 2) grid challenger — ยิงเมื่อมี gridText และ flat ยังไม่สมบูรณ์:
  //   • spatial (rapidocr): flat โชว์ collapse-SKIP keyword (column-shift จริง เช่น SODA/PR1950W)
  //   • structural (pdfplumber text-layer): flat มี SKIP ใดๆ → grid อาจ recover ได้ (transposed COA
  //     เช่น Suzorite ให้ SKIP "ค่าผลไม่ใช่ตัวเลข" ที่ไม่ match collapse keyword) ★ ไม่ยิงเมื่อ flat
  //     สะอาดแล้ว (skip=0) — ไม่เสีย LLM call เปล่า. ★ ไม่ยิงเพื่อพลิก FAIL→PASS (FAIL จริงต้องคง honest)
  const isStructural = gridSource === "structural";
  const triggerGrid =
    !!gridText &&
    (hasCollapseSymptom(flatReport) ||
      (isStructural && flatReport.summary.skip > 0));
  if (triggerGrid) {
    console.log(
      `  [keep-best] flat ยังไม่สมบูรณ์ (${gridSource ?? "spatial"} grid) → ลอง grid challenger (${gridText!.length} chars)`
    );
    dumpDebug("_last-ocr-grid.txt", gridText!);
    const gridReport = await runExtractionPass(
      filename, filePath, gridText!, text, engine, page, new OllamaCoaService(), "grid", gridSource, gridOrient
    );
    if (gridBeatsFlat(gridReport, flatReport)) {
      // grid won → carry product/lotNo from flat when the grid pass didn't recover them (the
      //   structural parser doesn't see prose like "GRADE: …" that the flat LLM read) — cosmetic.
      if (!gridReport.product && flatReport.product) gridReport.product = flatReport.product;
      if (!gridReport.lotNo && flatReport.lotNo) gridReport.lotNo = flatReport.lotNo;
      // ★ Anti-deceptive (BLOCKER fix) ★ — pass-guard เป็น column-blind → พิสูจน์ column ของ grid ไม่ได้.
      //   grid PASS ที่ "flat ยืนยันไม่ได้" (row ใหม่ หรือ name/spec/result ต่างจาก flat PASS) ต้องไม่เป็น
      //   เขียวเงียบ. ขึ้นกับ provenance ของ column:
      //   • spatial (rapidocr): column INFERRED → amber เสมอ (พิสูจน์ mapping ไม่ได้)
      //   • structural (pdfplumber ruling-line): column geometry-VERIFIED → balanced amber — clean-green
      //     เฉพาะค่าอยู่กลางช่วง spec 2 ด้าน (ห่างขอบ); one-sided/ใกล้ขอบ/อ่านไม่ได้ → amber.
      //     = แก้ over-flag ที่ราก: column เชื่อได้แล้ว ค่าปลอดภัยจริง → ไม่ต้อง "ต้องตรวจ" ทุกแถว
      const flatPassKeys = new Set(
        flatReport.rows.filter((r) => r.status === "PASS").map(passKey)
      );
      let surfaced = 0;
      let greenlit = 0;
      for (const r of gridReport.rows) {
        if (r.status === "PASS" && !flatPassKeys.has(passKey(r))) {
          const amber = isStructural ? isNearSpecBoundary(r) : true;
          if (amber) {
            r.needsReview = true;
            surfaced++;
          } else {
            greenlit++;
          }
        }
      }
      console.log(
        `  [keep-best] ✓ grid ชนะ ${passCount(flatReport)}P→${passCount(gridReport)}P (0 FAIL, PASS เดิมครบ) — ใช้ grid · needsReview +${surfaced}${
          isStructural ? ` · clean-green +${greenlit} (structural mid-range)` : ""
        }`
      );
      return gridReport;
    }
    console.log(
      `  [keep-best] ✗ grid ${passCount(gridReport)}P ไม่ชนะ flat ${passCount(flatReport)}P ขาด — คง flat`
    );
  }
  return flatReport;
}

// ★ HQ OCR fallback toggle ★ — scanned page ที่ best ยังมี SKIP → re-OCR ด้วย HQ engine (v5-server, daemon
//   lazy-load) เป็น challenger ชั้นนอกสุด. default เปิด. COA_OCR_HQ_FALLBACK=false ปิด (กลับไป mobile ล้วน)
const OCR_HQ_FALLBACK_ENABLED = process.env.COA_OCR_HQ_FALLBACK !== "false";

// processPage — keep-best orchestrator ต่อ 1 หน้า (2 ชั้น)
//   ชั้นใน: runFlatGridBest บน OCR default (mobile) — flat floor + grid challenger
//   ชั้นนอก: ★ HQ OCR challenger ★ — ถ้า best (scanned) ยังมี SKIP → re-OCR ด้วย v5-server แล้ว
//     keep เฉพาะเมื่อชนะ best ขาด (gridBeatsFlat: เพิ่ม PASS, ไม่ลด PASS เดิม, 0 FAIL)
//   ★ anti-regression by construction: best เป็น floor — HQ ทำให้ดีขึ้นได้ ทำให้แย่ลงไม่ได้ ★
//   (เคส 4A: mobile อ่าน LoI spec "%98"→SKIP · v5-server อ่าน "≤3.5%"→PASS → HQ 3P ชนะ mobile 2P)
async function processPage(
  filename: string,
  filePath: string,
  text: string,
  engine: OcrEngine,
  page: number,
  gridText?: string,
  gridSource?: GridSource,
  gridOrient?: GridOrient,
  imagePath?: string
): Promise<CoaReport> {
  const best = await runFlatGridBest(
    filename, filePath, text, engine, page, gridText, gridSource, gridOrient
  );

  // HQ challenger — เฉพาะ scanned (rapidocr) ที่ยังมี SKIP + มี imagePath ให้ re-OCR
  //   ไฟล์สะอาด (skip=0 เช่น Lot240521) ไม่ trigger → v5 ไม่ถูกโหลด/รัน = เท่าเดิม
  if (
    OCR_HQ_FALLBACK_ENABLED &&
    engine === "rapidocr" &&
    imagePath &&
    best.summary.skip > 0
  ) {
    console.log(
      `  [hq-ocr] best ยังมี ${best.summary.skip} SKIP (scanned) → re-OCR HQ challenger (daemon HQ engine, default v5-server)`
    );
    try {
      const hqOcr = await new RapidOcrService().extractTextBoth(imagePath, true);
      if (hqOcr && hqOcr.flat.replace(/\s/g, "").length >= 50) {
        dumpDebug("_last-ocr-hq.txt", hqOcr.flat);
        const hqGrid = GRID_LLM_ENABLED ? hqOcr.grid : undefined;
        // HQ grid = spatial (token-bbox inferred) — scanned-vector ต้องอาศัย pdfplumber geom (สร้างใน
        //   extractTextPerPage) ที่ raster scan ไม่มี → spatial เท่านั้น
        const hqBest = await runFlatGridBest(
          filename, filePath, hqOcr.flat, "rapidocr", page,
          hqGrid, hqGrid ? "spatial" : undefined, undefined
        );
        // gridBeatsFlat = "challenger ชนะ incumbent ขาด" (generic: 0 FAIL, PASS เดิมครบ, PASS เพิ่ม)
        if (gridBeatsFlat(hqBest, best)) {
          if (!hqBest.product && best.product) hqBest.product = best.product;
          if (!hqBest.lotNo && best.lotNo) hqBest.lotNo = best.lotNo;
          console.log(
            `  [hq-ocr] ✓ HQ ชนะ ${passCount(best)}P→${passCount(hqBest)}P (0 FAIL, PASS เดิมครบ) — ใช้ HQ`
          );
          return hqBest;
        }
        console.log(
          `  [hq-ocr] ✗ HQ ${passCount(hqBest)}P ไม่ชนะ best ${passCount(best)}P ขาด — คง best`
        );
      } else {
        console.warn(`  [hq-ocr] HQ OCR thin/failed — คง best`);
      }
    } catch (e) {
      console.warn(`  [hq-ocr] HQ challenger error — คง best:`, (e as Error).message);
    }
  }
  return best;
}

// Entry point ของ pipeline — เรียกจากทั้ง HTTP route และ CLI (test-coa.ts)
// คืน CoaReport[] หนึ่งตัวต่อหน้า PDF (single-page/image = [1 report])
export async function runCoaPipeline(filePath: string): Promise<CoaReport[]> {
  const filename = path.basename(filePath).replace(/^\d+-/, "");
  const pages = await extractTextPerPage(filePath);
  const reports: CoaReport[] = [];
  for (const pg of pages) {
    dumpDebug("_last-ocr.txt", pg.text); // debug, overwrite per page
    if (!pg.text.trim()) continue;        // skip blank pages (pinned)
    reports.push(
      await processPage(filename, filePath, pg.text, pg.engine, pg.page, pg.gridText, pg.gridSource, pg.gridOrient, pg.imagePath)
    );
  }
  if (reports.length === 0) {
    // all pages blank → one empty report so route/UI still render
    reports.push({
      filename,
      product: null,
      lotNo: null,
      page: 1,
      rows: [],
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
      debug: {
        ocrEngine: pages[0]?.engine ?? "rapidocr",
        ocrText: "",
        llmModel: new OllamaCoaService().modelName,
        llmRaw: null,
      },
    });
  }
  return reports;
}

// backward-compat: เรียกจาก _validate/ scripts และ ab-models.ts
// คืน {text, engine} ของหน้าแรกที่มีข้อความ (หรือหน้าแรกถ้าว่างทั้งหมด)
export async function extractText(
  filePath: string
): Promise<{ text: string; engine: OcrEngine }> {
  const pages = await extractTextPerPage(filePath);
  const first = pages.find((p) => p.text.trim()) ?? pages[0];
  if (!first) {
    // ไม่มีหน้าเลย (ไม่ควรเกิด) → fallback
    return { text: "", engine: "rapidocr" };
  }
  return { text: first.text, engine: first.engine };
}

function truncForLog(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
