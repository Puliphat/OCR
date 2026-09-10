// ★ หัวใจของระบบ ★ — orchestrator 3 ขั้น: extract text → LLM parse → evaluate
// แก้ลำดับขั้น/เปลี่ยน OCR engine/เปลี่ยน LLM service ที่นี่
import * as fs from "fs";
import * as path from "path";
import { PdfService } from "../pdf.service";
import { ImageProcessingService } from "../image-processing.service";
import { OllamaCoaService, RawCoa } from "./ollama-coa.service";
import { RapidOcrService, OcrToken } from "./rapidocr.service";
import { buildScannedGrid, VectorGeom } from "./scanned-grid-builder";
import { evaluateCoa, summarize, CoaReport, EvaluatedItem } from "./coa-evaluator";
import { extractPdfText, extractPdfTextPerPage } from "./pdf-text-extractor";
import { recoverProductLot } from "./product-lot-recovery";
import { extractPdfGridPerPage } from "./pdf-grid-extractor";
import { parseStructuralGrid, GridOrient } from "./parse-structural-grid";
import {
  recoverSpecsFromOcr,
  correctSpecDirectionFromOcr,
  applyHeaderDirectionHints,
} from "./spec-recovery";
import { recoverResultsFromOcr } from "./result-recovery";
import { recoverResultMinMax } from "./result-minmax-recovery";
import { recoverAverageColumn } from "./avg-column-recovery";
import { recoverSpecificationColumn, reconcileDupontSpecs } from "./spec-column-recovery";
import { downgradeColumnShiftedResults } from "./column-shift-recovery";
import { realignTransposedLabels } from "./transposed-label-recovery";
import { dropUngroundedSpecBounds } from "./spec-bound-grounding";
import { recoverSpecPairs } from "./spec-pair-recovery";
import { recoverSplitTextRows } from "./text-row-recovery";
import { recoverSieveTableResults, recoverMissingSieveRows } from "./sieve-table-recovery";
import { extractHeaderDirectionHints } from "./header-direction";
import { recoverLimitColumns } from "./limit-columns-recovery";
import { recoverLotRowTable } from "./lot-row-table-recovery";
import { recoverParenSpecRows } from "./paren-spec-recovery";
import { recoverSplitBoundCells } from "./bound-cell-recovery";
import { recoverSpecRowBelow } from "./spec-row-below-recovery";
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
//   rapidocr engine เท่านั้น (text-layer ไม่มี token bbox)
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
// RapidOCR = OCR ตัวเดียวของระบบ (CPU ~300MB) — ไม่มี fallback engine แล้ว
// คืน engine ที่อ่านสำเร็จด้วย (text-layer/rapidocr) → แนบ CoaReport.debug ให้รู้ว่าพังขั้นไหน
export type OcrEngine = "text-layer" | "rapidocr";

// ★ error code ที่ FE branch ได้ ★ — daemon ล่ม = กดปุ่มเริ่ม daemon แล้วลองใหม่ได้
//   ไฟล์โล่ง = ไม่ต้องรีสตาร์ต daemon (รีไปก็เหมือนเดิม) ต้องไปดูไฟล์
export const OCR_DAEMON_DOWN = "OCR_DAEMON_DOWN";
export const OCR_EMPTY_RESULT = "OCR_EMPTY_RESULT";

// ★ progress callback ★ — pipeline บอกขั้นที่กำลังทำ (route เอาไปให้หน้าเว็บ poll โชว์ progress)
//   ไม่ส่ง callback มา = เงียบเหมือนเดิม (CLI/corpus runner ไม่กระทบ)
export type PipelineProgress = {
  stage: "render" | "ocr" | "parse" | "hq" | "th" | "eval";
  page?: number;
  pages?: number;
};
export type ProgressFn = (p: PipelineProgress) => void;

// OCR portion only — รับ path รูปที่ render ไว้แล้ว คืน {text, engine}
// ★ RapidOCR อย่างเดียว ไม่มี fallback ★ — Tesseract ถูกถอดออก (ROUND 23): มันให้ผล "อ่านได้แต่เลขเพี้ยน"
//   ซึ่งเข้าทาง failure mode ที่แย่ที่สุดของระบบนี้ (PASS/FAIL จากตัวเลขที่ผิด = deceptive) ต่างจากพังดังๆ
//   ที่คนเห็นแล้วแก้ได้. daemon ล่ม → โยน error ขึ้นไปให้หน้าเว็บเตือน + เสนอปุ่มเริ่ม daemon
async function ocrImage(
  imagePath: string
): Promise<{ text: string; engine: OcrEngine; gridText?: string; tokens?: OcrToken[]; correctionAngle?: number }> {
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
  // แยกสาเหตุให้ชัด (อย่าโทษ daemon เมื่อ daemon ขึ้นอยู่ — misdirection แบบเดิม):
  //   daemonDown = ติดต่อ daemon ไม่ได้/500 · ไม่ใช่ = daemon อ่านแล้วได้ข้อความน้อย (ไฟล์โล่ง/สแกนแย่)
  const daemonDown = text == null;
  console.error(
    daemonDown
      ? `  [rapidocr] ✗ daemon unreachable — abort (ไม่มี fallback engine แล้ว)`
      : `  [rapidocr] ✗ thin result (<50 chars, daemon ขึ้นอยู่) — abort`
  );
  throw new Error(
    daemonDown
      ? `${OCR_DAEMON_DOWN}: OCR daemon ไม่ตอบสนอง — เริ่ม daemon แล้วลองใหม่ (backend: npm run ocr:daemon)`
      : `${OCR_EMPTY_RESULT}: OCR daemon ทำงานอยู่แต่อ่านข้อความจากไฟล์นี้แทบไม่ได้ — ไฟล์อาจเป็นหน้าเปล่า/สแกนคุณภาพต่ำ`
  );
}

// Extract text per page — คืน array [{text, engine, page}] หนึ่งตัวต่อหน้า
// image file (png/jpg) → คืน 1 entry, page=1
// pdf → ลอง text-layer ต่อหน้า; หน้าที่ไม่มี usable text → render + OCR
export async function extractTextPerPage(
  filePath: string,
  onProgress?: ProgressFn
): Promise<PageExtract[]> {
  const ext = path.extname(filePath).toLowerCase();

  // ไฟล์รูป → OCR เดียว, page=1
  if (ext !== ".pdf") {
    onProgress?.({ stage: "ocr", page: 1, pages: 1 });
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
    onProgress?.({ stage: "render" });
    imgs = await new PdfService().convertToImage(filePath);
  }

  // ถ้า extractPdfTextPerPage ล้มทั้งหมด → OCR ทุก rendered page
  if (pages.length === 0) {
    const results: PageExtract[] = [];
    for (let i = 0; i < imgs.length; i++) {
      onProgress?.({ stage: "ocr", page: i + 1, pages: imgs.length });
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
      onProgress?.({ stage: "ocr", page: i + 1, pages: pages.length });
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

// ชื่อ row สำหรับเทียบ PASS ข้าม variant — ยุบ whitespace + μ/µ + วรรคตอน (คง latin/digit/CJK)
//   flat/structural/HQ สะกดชื่อไม่เหมือนกัน: "Ba SO4"="BaSO4" · "D 100"="D100" ·
//   ★ v5 "Residue on sieve(106m)" vs mobile "(106 μ m)" ★ (บั๊ก TEST-LOG ROUND 15 item 2 — μ ทำ HQ
//   ที่ชนะจริง 7P>6P ถูก reject เพราะนับว่า "PASS เดิมหาย")
function passNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\sµμ]+/g, "")
    .replace(/[^a-z0-9぀-ヿ一-鿿]/g, "");
}

// fingerprint ค่า+เกณฑ์ของ PASS row — ใช้เมื่อชื่อเทียบกันไม่ได้เลย เพราะ incumbent อ่านชื่อผิด
//   (KGP-H65: flat หยิบ unit มาเป็นชื่อ "g/ml" ขณะ grid อ่านถูก "嵩密度" — แถวเดียวกัน ค่า+เกณฑ์ตรงเป๊ะ)
//   ครบชุด (result+min+max) จึงบังเอิญตรงกันข้ามแถวได้ยาก → ปลอดภัยพอจะใช้เป็น fallback
function passValueKey(r: EvaluatedItem): string {
  return `${r.result ?? ""}|${r.min ?? ""}|${r.max ?? ""}`;
}

// ★ PASS-preservation ★ — challenger ต้องเก็บ PASS เดิมของ incumbent ครบทุกแถว
//   จับคู่ 1:1 แบบ greedy (= multiset โดยธรรมชาติ → ตาราง sieve ชื่อซ้ำ RI-015 "Particle Size" ×4
//   ยังนับแยกแถวถูก) · เกณฑ์จับคู่: ชื่อ normalize ตรง **หรือ** ค่า+เกณฑ์ตรง
function preservesPasses(challenger: CoaReport, incumbent: CoaReport): boolean {
  const pool = challenger.rows.filter((r) => r.status === "PASS");
  const used = new Set<number>();
  for (const need of incumbent.rows) {
    if (need.status !== "PASS") continue;
    const nk = passNameKey(need.name);
    let hit = pool.findIndex((c, i) => !used.has(i) && passNameKey(c.name) === nk);
    if (hit < 0) {
      const vk = passValueKey(need);
      hit = pool.findIndex((c, i) => !used.has(i) && passValueKey(c) === vk);
    }
    if (hit < 0) return false; // PASS เดิมหายจริง → challenger แพ้
    used.add(hit);
  }
  return true;
}

// ปักธงให้คนตรวจทุกแถว PASS ของ challenger ที่ incumbent ยืนยันไม่ได้ — ไม่งั้นเลขที่เถียงกันอยู่ขึ้นจอเป็นเขียว
//   ชื่อตรงแต่ค่าต่าง = เขียนทับแถวที่ผ่านแล้ว (amber เสมอ) · ค่าตรงแต่ชื่อต่าง = ยืนยันแล้ว · แถวใหม่ = ตาม column provenance
export function flagChallengerPasses(
  challenger: CoaReport,
  incumbent: CoaReport,
  engine: OcrEngine,
  gridSource: GridSource | undefined
): { surfaced: number; greenlit: number; overwritten: string[]; marginCleared: number } {
  const isStructural = gridSource === "structural";
  const pool = incumbent.rows.filter((r) => r.status === "PASS");
  const used = new Set<number>();
  const overwritten: string[] = [];
  let surfaced = 0;
  let greenlit = 0;

  const flag = (r: EvaluatedItem, why: string) => {
    r.reason = r.reason?.trim() ? `${r.reason} · ${why}` : why;
    if (!r.needsReview) surfaced++;
    r.needsReview = true;
  };

  // phase 1: คู่ที่ชื่อ+ค่าตรงกันเป๊ะ จับให้หมดก่อน — ไม่งั้นตารางชื่อซ้ำ (RI-015 "Particle Size" ×4)
  //   แถวแรกจะไปกินคู่ของแถวหลัง แล้วฟ้องว่าเขียนทับทั้งที่ค่าเดิมยังอยู่ครบ
  const pending: EvaluatedItem[] = [];
  for (const r of challenger.rows) {
    if (r.status !== "PASS") continue;
    const nk = passNameKey(r.name);
    const vk = passValueKey(r);
    const hit = pool.findIndex(
      (c, i) => !used.has(i) && passNameKey(c.name) === nk && passValueKey(c) === vk
    );
    if (hit >= 0) used.add(hit);
    else pending.push(r);
  }

  // phase 2: ชื่อตรงแต่ค่าไม่ตรง = challenger เขียนเลขทับแถวที่ผ่านอยู่แล้ว → ธงเหนียว ล้างไม่ได้
  const leftover: EvaluatedItem[] = [];
  for (const r of pending) {
    const nk = passNameKey(r.name);
    const hit = pool.findIndex((c, i) => !used.has(i) && passNameKey(c.name) === nk);
    if (hit < 0) {
      leftover.push(r);
      continue;
    }
    used.add(hit);
    const move = `${passValueKey(pool[hit])} → ${passValueKey(r)}`;
    overwritten.push(`${r.name}: ${move} (ค่า|min|max)`);
    r.valueDisputed = true;
    flag(r, `เลขแถวนี้ไม่ตรงกับที่อ่านรอบแรก (${move} = ค่า|min|max) — เทียบกับใบจริง`);
  }

  // phase 3: ชื่อเทียบไม่ได้เลย — ยืนยันด้วยค่าได้เฉพาะค่าที่ไม่ว่าง และ triple ไม่ซ้ำในฝั่ง incumbent
  //   "≤15 + ค่าผลว่าง" ไม่ใช่ลายนิ้วมือ (RI-015 มี 3 แถวเกณฑ์ <15) → ยืนยันข้ามแถวมั่วได้
  for (const r of leftover) {
    const vk = passValueKey(r);
    const unique = r.result != null && pool.filter((c) => passValueKey(c) === vk).length === 1;
    if (unique && pool.some((c, i) => !used.has(i) && passValueKey(c) === vk)) {
      used.add(pool.findIndex((c, i) => !used.has(i) && passValueKey(c) === vk));
      continue; // incumbent อ่านชื่อผิด แต่ค่า+เกณฑ์ตรง (KGP-H65 "g/ml" vs "嵩密度")
    }
    if (isStructural && !structuralPassNeedsAmber(r)) {
      greenlit++;
      continue;
    }
    flag(r, "แถวนี้รอบแรกยืนยันไม่ได้ (อ่านคอลัมน์ใหม่) — เทียบกับใบจริง");
  }

  // margin-green รันซ้ำเพราะธงข้างบนปักหลังรอบแรกใน runExtractionPass — CLEAR-ONLY, G0 กัน spatial
  //   และ G6 กันแถว valueDisputed ไว้แล้ว (margin ตอบไม่ได้ว่า "เลขไหนคือเลขบนใบ")
  const amberBefore = challenger.rows.filter((r) => r.needsReview).length;
  applyMarginGreen(challenger.rows, engine, gridSource);
  const marginCleared = amberBefore - challenger.rows.filter((r) => r.needsReview).length;

  return { surfaced, greenlit, overwritten, marginCleared };
}

// ★ keep-best gate (anti-regression) ★ — เก็บ grid เฉพาะเมื่อครบ 3:
//   (1) grid ไม่สร้าง FAIL (2) grid PASS count ต่อชื่อ ≥ flat ทุกชื่อ (multiset — ห้ามทำ PASS ดีหาย แม้ชื่อซ้ำ)
//   (3) grid เพิ่ม PASS รวม. ไม่ครบ → คง flat → 0 regression. (ZP10: grid 1P < flat 4P → คง flat)
function gridBeatsFlat(grid: CoaReport, flat: CoaReport): boolean {
  if (grid.summary.fail > 0) return false;
  if (!preservesPasses(grid, flat)) return false;
  return passCount(grid) > passCount(flat);
}

const VALUE_MARGIN_M = 0.30; // margin-green gate: result must be ≥30% of |result| away from the binding spec bound

// ★ structural grid → digits are EXTRACTED, not recognized ★ (ROUND 22)
//   gridSource="structural" ตั้งได้เฉพาะหน้า engine="text-layer" (ดู extractTextPerPage) = ตัวเลขดึงจาก
//   text layer ของ PDF ตรงๆ + คอลัมน์ยืนยันด้วย ruling line ของ pdfplumber → ความเสี่ยงที่ margin-green
//   G2–G4 กันอยู่ (digit scramble / ทศนิยมหาย / คอลัมน์เดา) เป็นความเสี่ยงของ OCR ล้วน ซึ่ง path นี้ไม่มี.
//   ปักธงตาม "ใกล้ขอบ" บน path นี้ = ธงเฟ้อทั้งที่ตัวเลขเชื่อได้ (KGP-H65: 4/7 แถว ⚠ ทั้งที่ตรงใบจริง
//   + ตรงตรา 合格 ของ QA เอง) → คนเลิกเชื่อธง = อันตรายกว่าไม่มีธง
//   ★ ค่าตรงขอบ spec พอดีก็ไม่ amber (user decision 2026-08-03): ค่าที่อยู่ในกรอบ min/max รวมค่าติดขอบ
//     = ผ่านตามใบจริง ไม่ต้องให้คนตรวจซ้ำ · หลุดกรอบเมื่อไรถึงเป็น FAIL ★
//   ★ ไม่แตะ path อื่น: spatial / scanned-vector (คอลัมน์เดา หรือเลขมาจาก OCR) ยัง amber เสมอ ★
function structuralPassNeedsAmber(r: EvaluatedItem): boolean {
  const res = typeof r.result === "number" ? r.result : Number(r.result);
  if (!Number.isFinite(res)) return true;
  if (r.min == null && r.max == null) return true; // ไม่มีขอบให้เทียบ → ไม่ปล่อยเขียว
  return false;
}

// ★ Margin-green policy (Track 2 + scanned-vector) ★ — CLEAR-ONLY: sets needsReview=false on PASS
//   rows that are safely away from spec bounds. Never sets needsReview=true (only guards do that).
//   Five gates must ALL pass:
//   G0 column-trust allow-list: structural | scanned-vector | text-layer flat (never spatial)
//   G1 status=PASS
//   G2 margin = clearance/|result| >= VALUE_MARGIN_M
//   G3' integer decimal-shift guard (both directions, mirrors detectDecimalRisk)
//   G4 decimal-present: if binding bound is fractional, resultRaw must contain a decimal point
//   G5 ambiguous-thousands: comma ที่อ่านได้ 2 ทาง (1,500) → ค่าอาจเพี้ยน 1000 เท่า margin จึงไม่มีความหมาย
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

    // G5: ธง ambiguous-thousands ล้างไม่ได้ — ถ้า comma เป็นหลักพันจริง ค่าเพี้ยน 1000 เท่า margin ไร้ความหมาย
    if (r.ambiguousThousands) continue;

    // G6: OCR 2 รอบอ่านเลขนี้ไม่เหมือนกัน → margin ตอบไม่ได้ว่าเลขไหนคือเลขบนใบ ล้างธงไม่ได้
    if (r.valueDisputed) continue;

    // G7: แถวที่ระบบประกอบเองจากตำแหน่งช่อง — margin ตอบไม่ได้ว่าจับคู่คอลัมน์ถูกไหม
    if (r.columnRebuilt) continue;

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
    raw = parseStructuralGrid(
      llmInput,
      gridOrient ?? "normal",
      gridSource === "scanned-vector" ? "scanned-vector" : "structural"
    );
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

  // ตารางหลายล็อต (เกณฑ์บรรทัดเดียว ค่าบรรทัดละล็อต) — อ่านเองตามตำแหน่งช่อง แม่นกว่า LLM ที่หยิบชื่อ
  //   คอลัมน์มาเป็นชื่อแถวแล้วค่าเลื่อน · จำนวนช่องไม่ตรงเมื่อไร โมดูลนี้ถอยเอง
  const lotTable = recoverLotRowTable(text);
  if (lotTable) {
    console.log(
      `  [lot-table] อ่านตารางหลายล็อตเอง ${lotTable.lots.length} ล็อต × ${
        lotTable.items.length / lotTable.lots.length
      } คอลัมน์ = ${lotTable.items.length} แถว (แทนผล LLM ${raw.items?.length ?? 0} แถว)`
    );
    raw.items = lotTable.items;
  }

  // ใบที่วางเกณฑ์ไว้ในวงเล็บท้ายบรรทัด + วัดหลายครั้งก่อนช่อง Average → อ่านช่องก่อนวงเล็บเป็นค่าผล
  //   เก็บแถวข้อความของ LLM (Appearance/Oil ที่ไม่มีตัวเลข) ไว้ด้วย ไม่งั้นรายการหายจากจอ
  const parenSpec = lotTable ? null : recoverParenSpecRows(text);
  if (parenSpec) {
    const textRows = (raw.items ?? []).filter((i) => !/\d/.test(String(i.result ?? "")));
    console.log(
      `  [paren-spec] อ่านเกณฑ์ในวงเล็บ + ช่อง Average เอง ${parenSpec.rows} แถว (แทนผล LLM ${raw.items?.length ?? 0} แถว)`
    );
    raw.items = [...parenSpec.items, ...textRows];
  }

  // ใบแนวนอนที่แถว Specifications อยู่ "ใต้" แถวค่า (Tin Powder) — LLM ไม่ออกแถวเลย ต้องจับคู่เองโดยยึดขวา
  const specBelow = lotTable || parenSpec ? null : recoverSpecRowBelow(text);
  if (specBelow) {
    console.log(
      `  [spec-below] อ่านตารางแนวนอนที่เกณฑ์อยู่ใต้ค่า ${specBelow.labels} คอลัมน์ (แทนผล LLM ${raw.items?.length ?? 0} แถว)`
    );
    raw.items = specBelow.items;
  }

  // OCR แยกคำ Max/Min เป็นช่องลอย → LLM หยิบมาเป็นค่าผล ทำทั้งแถวเป็น SKIP ทั้งที่ใบอ่านออก
  const boundCells = recoverSplitBoundCells(raw.items ?? [], text);
  if (boundCells.fixed.length > 0) {
    console.log(
      `  [bound-cell] ต่อคำ Max/Min กลับเข้าเกณฑ์ ${boundCells.fixed.length} รายการ: ${boundCells.fixed
        .map((f) => `${f.name}(${f.spec} ผล ${f.result})`)
        .join(", ")}`
    );
  }

  // ตัดขอบเกณฑ์ที่ไม่ได้อยู่ในบรรทัดของแถวตัวเอง (LLM ข้ามช่องว่างแล้วยืมเลขของแถวถัดไป)
  const boundFix = dropUngroundedSpecBounds(raw.items ?? [], text);
  if (boundFix.fixed.length > 0) {
    console.log(
      `  [spec-bound] ตัดขอบที่ไม่อยู่ในแถว ${boundFix.fixed.length} รายการ: ${boundFix.fixed
        .map((f) => `${f.name}(${f.from}→${f.to})`)
        .join(", ")}`
    );
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

  // เกณฑ์สองช่องที่ขีดกลางหายตอน OCR — อ่าน header ของใบว่าช่องไหนคือค่าผล ช่องท้ายที่เหลือคือเกณฑ์
  const pairs = recoverSpecPairs(raw.items ?? [], text);
  if (pairs.paired.length > 0) {
    console.log(
      `  [spec-pair] เติมขอบเกณฑ์ที่ขาด ${pairs.paired.length} รายการ: ${pairs.paired
        .map((p) => `${p.name}(${p.from}→${p.to})`)
        .join(", ")}`
    );
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

  // ใบที่หัวตารางวางเกณฑ์ไว้ก่อนค่าผล (Lower/Upper limit → Analysis Results) — ไม่ใช่ท่านั้นจะไม่แตะเลย
  const limitCols = recoverLimitColumns(raw.items ?? [], text);
  if (limitCols.fixed.length > 0) {
    console.log(
      `  [limit-cols] อ่านคอลัมน์ตามหัวตาราง Lower/Upper limit ${limitCols.fixed.length} รายการ: ${limitCols.fixed
        .map((f) => `${f.name}(${f.from} → ${f.to})`)
        .join(", ")}`
    );
  }

  // ★ Result-side Min|Max recovery (deterministic, header-anchored) ★ — ใบที่ฝั่งผลแตกเป็น 2 คอลัมน์
  //   Min|Max (ไม่มีคอลัมน์ result เดี่ยว เช่น RB220) → ค่าที่วัดได้เป็น "ช่วง" ต้องอยู่ในกรอบ spec ทั้งช่วง.
  //   qwen3:4b map พลาดทุกรัน → กู้จาก header เอง. ★ ABSTAIN ถ้าไม่เจอโครง Results/Limits + Min./Max. ★
  //   รันท้ายสุดก่อน eval (เหมือน spec-column) เพื่อไม่ให้ pass อื่นทับ spec/result ที่แก้แล้ว
  const minMaxRec = recoverResultMinMax(raw.items ?? [], text);
  if (minMaxRec.overridden.length > 0) {
    console.log(
      `  [result-minmax] กู้ result เป็นช่วง Min|Max ${minMaxRec.overridden.length} รายการ: ${minMaxRec.overridden
        .map((o) => `${o.name}(${o.resultMin}–${o.resultMax} vs ${o.specMin ?? "-"}~${o.specMax ?? "-"})`)
        .join(", ")}`
    );
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

  // แถวที่อ่านคอลัมน์ใหม่ตามหัวตาราง Lower/Upper limit — เปลี่ยนทั้งค่าและเกณฑ์ ต้องให้คนตรวจ
  if (limitCols.fixed.length > 0) {
    const names = new Set(limitCols.fixed.map((f) => f.name.trim()));
    for (const r of evaluated.rows) {
      if (!names.has(r.name.trim())) continue;
      r.needsReview = true;
      r.columnRebuilt = true;
      const why = "ระบบอ่านคอลัมน์ใหม่ตามหัวตาราง (เกณฑ์อยู่ก่อนค่าผล) — เทียบกับใบจริง";
      r.reason = r.reason?.trim() ? `${r.reason} · ${why}` : why;
    }
  }

  // แถวที่ระบบจับคู่เกณฑ์-ค่าเองตามตำแหน่งช่อง — คนต้องตรวจ เหมือน path spatial อื่น
  const rebuilt = lotTable?.items ?? parenSpec?.items ?? specBelow?.items;
  if (rebuilt) {
    const why = lotTable
      ? "ระบบจับคู่เกณฑ์กับค่าตามตำแหน่งช่องในตารางหลายล็อต — เทียบกับใบจริง"
      : parenSpec
      ? "ระบบอ่านค่าจากช่อง Average และเกณฑ์ในวงเล็บเอง — เทียบกับใบจริง"
      : "ระบบจับคู่เกณฑ์ที่อยู่ใต้แถวค่าโดยยึดคอลัมน์ขวา — เทียบกับใบจริง";
    const names = new Set(rebuilt.map((i) => String(i.name ?? "").trim()));
    for (const r of evaluated.rows) {
      if (!names.has(r.name.trim())) continue;
      r.needsReview = true;
      r.columnRebuilt = true;
      r.reason = r.reason?.trim() ? `${r.reason} · ${why}` : why;
    }
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

  // ★ Missing sieve-row recovery ★ — แถว sieve ที่ LLM ทิ้งทั้งแถว (RI-015 `2.000|0.0|0.0`) → เติมจาก OCR
  const missingSieve = recoverMissingSieveRows(evaluated.rows, text);
  if (missingSieve.added.length > 0) {
    console.log(
      `  [missing-sieve] เติม ${missingSieve.added.length} แถวที่ LLM ทิ้ง: ${missingSieve.added
        .map((s) => `${s.name}(spec=${s.spec} result=${s.result} → ${s.status})`)
        .join(", ")}`
    );
  }

  // ★ promote boundary-exact (เฉพาะ grid ที่ geometry ยืนยัน) ★ — evaluateCoa downgrade PASS ที่ result ตรงขอบ spec พอดี
  //   (กัน LLM ปลอม) แต่ที่นี่ bound มาจากคอลัมน์ Lower/Upper จริง = PASS แท้ · promote SKIP→PASS แบบ
  //   เขียวล้วน (user decision 2026-08-03: ติดขอบแต่อยู่ในกรอบ = ผ่าน ไม่ต้องตรวจซ้ำ) · เฉพาะ min≠max
  let boundaryPromoted = 0;
  if (isDeterministicGrid) {
    for (const r of evaluated.rows) {
      if (r.status !== "SKIP" || r.min == null || r.max == null || r.min === r.max) continue;
      const res = typeof r.result === "number" ? r.result : Number(r.result);
      if (!Number.isFinite(res)) continue;
      if (res >= r.min && res <= r.max && (res === r.min || res === r.max)) {
        r.status = "PASS";
        r.needsReview = false;
        r.reason = "ค่าผลตรงขอบเกณฑ์พอดี (คอลัมน์ยืนยันด้วย geometry) — อยู่ในเกณฑ์ ผ่าน";
        boundaryPromoted++;
      }
    }
    if (boundaryPromoted > 0) {
      console.log(
        `  [boundary-promote] promote ${boundaryPromoted} SKIP→PASS (geometry-verified boundary-exact)`
      );
    }
  }

  // แถวข้อความที่ OCR ตัดเกณฑ์กับผลคนละท่อน (色相 / APPEARANCE) — ใบเขียนไว้ทั้งสองช่องอยู่แล้ว
  const textRows = recoverSplitTextRows(evaluated.rows, text);
  if (textRows.recovered.length > 0) {
    console.log(
      `  [text-row] แถวข้อความตรงกับใบ ${textRows.recovered.length} รายการ: ${textRows.recovered
        .map((t) => `${t.name}(${t.spec}/${t.result})`)
        .join(", ")}`
    );
  }

  // ตารางแนวนอนที่ชื่อกับค่าเลื่อนกัน (TAIHEIYO CMF) — จับคู่ใหม่ตามตำแหน่งช่องใน OCR
  const realign = realignTransposedLabels(evaluated.rows, text);
  if (realign.realigned.length > 0) {
    console.log(
      `  [transposed-label] จับคู่ชื่อ↔ค่าใหม่ ${realign.realigned.length} แถว: ${realign.realigned
        .map((r) => `${r.name}(${r.from}→${r.to})`)
        .join(", ")}`
    );
  }

  // ★ result-recovery / avg-column override → ไม่ปักธงแล้ว (user decision 2026-08-03) ★
  //   ทั้งสอง path กู้ค่าแบบ "cell เดียวบนบรรทัด anchor unique" (precondition แน่น) แล้วส่งให้ evaluator
  //   ตัดสินตามปกติ → เข้ากรอบ min/max = PASS, หลุดกรอบ = FAIL. เดิมยังปัก amber เมื่อค่าใกล้/ติดขอบ
  //   ซึ่งหน้างานต้องตรวจซ้ำทั้งที่ค่าถูก (verify corpus 17 ไฟล์: ค่าที่ปักธงถูกตรงใบจริง 12/12).
  //   ★ column-remap (grid-won spatial / sieve-recovery) ยังปักธงตามเดิม — re-read ทั้งคอลัมน์เสี่ยงกว่า ★

  // ★ spec-column (DuPont) → surface ALL detected rows ★ — the spec was re-sourced from an inferred
  //   (spatial) grid; even a corrected/unchanged spec must be human-verified, never silent clean-green.
  //   ★ ปัก specDupont ไว้ด้วย ★ — เอกสารแบบนี้ซ้ำบล็อกเดิมหลายหน้า → หลังรันครบทุกหน้าเอามายันกันเองได้
  //   (reconcileDupontSpecs) ซึ่งเป็นหลักฐานที่หน้าเดียวไม่มี
  if (specDupontNames.size > 0) {
    for (const r of evaluated.rows) {
      if (!specDupontNames.has(r.name.trim())) continue;
      r.specDupont = true;
      if (r.status === "PASS") r.needsReview = true;
    }
  }

  // re-summarize ครั้งเดียวหลัง guard ทุกตัว (fail + pass + column-shift + outlier) แก้ status เสร็จ
  if (
    failGuard.downgraded.length > 0 ||
    outlierGuard.downgraded.length > 0 ||
    passGuard.downgraded.length > 0 ||
    colShift.downgraded.length > 0 ||
    sieveRec.recovered.length > 0 ||
    boundaryPromoted > 0 ||
    textRows.recovered.length > 0
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
      // grid เดา/ยืนยัน column ไม่เหมือนกันในแต่ละ provenance → ปักธงตามนั้น (ดู flagChallengerPasses)
      const flag = flagChallengerPasses(gridReport, flatReport, engine, gridSource);
      for (const o of flag.overwritten) {
        console.warn(`  [keep-best] ⚠ grid เขียนเลขทับแถวที่ flat ผ่านอยู่แล้ว — ${o} · ปักธงให้คนตรวจ`);
      }
      console.log(
        `  [keep-best] ✓ grid ชนะ ${passCount(flatReport)}P→${passCount(gridReport)}P (0 FAIL, PASS เดิมครบ) — ใช้ grid · needsReview +${flag.surfaced}${
          isStructural ? ` · clean-green +${flag.greenlit} (structural, text-layer digits)` : ""
        }${flag.marginCleared > 0 ? ` · margin-green เคลียร์ ${flag.marginCleared}` : ""}`
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

// ★ HQ trigger filter ★ — SKIP ที่ re-OCR แล้ว "มีโอกาสหาย" = ต้องมีตัวเลขเกี่ยวข้องสักฝั่ง:
//   • spec/result มี digit → อาจเป็นเลขที่ OCR อ่านเพี้ยน (เคส 4A: spec "≤3.5%"→"%98") → HQ ลองได้
//   • ฝั่งใดฝั่งหนึ่ง null → OCR อาจอ่านตกทั้ง cell → HQ ลองได้
//   แถว text ล้วนทั้งสองฝั่ง (PR1950W "Appearance": spec="body" result="Powderwithoutforeign" =
//   visual check ไม่มีตัวเลขในเอกสารจริง) — OCR ดีแค่ไหนก็ยัง non-numeric → SKIP เหมือนเดิม →
//   ไม่เผา HQ challenger (~35s/หน้า: re-OCR v5-server + LLM รอบใหม่) ที่รู้ล่วงหน้าว่าแพ้
function skipMayBenefitFromHq(r: EvaluatedItem): boolean {
  // "" (LLM emit ค่าว่าง) นับเป็น "ไม่มีค่า" เหมือน null → ให้ HQ ลอง (conservative)
  const spec = r.specRaw?.trim() || (r.min ?? r.max)?.toString() || null;
  const res = r.resultRaw?.trim() || r.result?.toString() || null;
  if (spec == null || res == null) return true;
  return /\d/.test(spec) || /\d/.test(res);
}

// ★ Thai OCR challenger ★ — dict ของ engine default กับ hq ไม่มีอักษรไทยเลย → ใบไทยแบบสแกนเสียทั้งคอลัมน์
//   ชื่อรายการ (แถวเริ่มที่ "%" เฉยๆ) ซึ่ง**ไม่โผล่เป็น SKIP** จึงใช้ trigger เดียวกับ HQ ไม่ได้
const OCR_TH_FALLBACK_ENABLED = process.env.COA_OCR_TH_FALLBACK !== "false";

// env ที่พิมพ์ผิดหรือเว้นว่างต้องไม่ทำให้ด่านหลุด — `Number("")` = 0 และ `x < NaN` เป็น false เสมอ
// สองกรณีนั้นแปลว่า "ปล่อยผ่านทุกหน้า" โดยไม่มี log อะไรบอก
function envPositive(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ยอมรับผลจากเครื่องอ่านไทยเฉพาะเมื่อ**เห็นอักษรไทยจริง** — สัญญาณที่ engine default ปลอมไม่ได้ (dict มันไม่มีไทย)
// ★ ต้องผ่านทั้งจำนวนและสัดส่วน ★ วัดจริงกับใบ CJK/อังกฤษ 12 หน้า: รั่วสูงสุด 9 ตัว = 0.64% · ใบไทยจริง = 39.9%
const TH_MIN_CHARS = envPositive("COA_OCR_TH_MIN_CHARS", 20);
const TH_MIN_RATIO = envPositive("COA_OCR_TH_MIN_RATIO", 0.08);
function thaiCharCount(s: string): number {
  return (s.match(/[\u0E00-\u0E7F]/g) ?? []).length;
}

// ของที่ challenger ไทยส่งกลับออกมานอกเหนือจาก report: ข้อความไว้หาป้าย · จำนวน FAIL ที่ keep-best ทิ้ง
interface ThaiSink {
  text?: string;
  hiddenFail?: number;
}

// challenger ใบไทย — คืน report ที่ชนะ best ขาด หรือ null ถ้าใบไม่ใช่ไทย/อ่านแล้วไม่ชนะ
// โครงเดียวกับ HQ challenger เป๊ะ (gridBeatsFlat + flagChallengerPasses) → best เป็นพื้นเสมอ
async function thaiChallenge(
  filename: string,
  filePath: string,
  page: number,
  imagePath: string,
  best: CoaReport,
  onProgress?: ProgressFn,
  sink?: ThaiSink
): Promise<CoaReport | null> {
  try {
    // แจ้ง stage ก่อน OCR — ทุกหน้าสแกนจ่ายค่าอ่านรอบนี้ หน้าเว็บต้องบอกว่ากำลังทำอะไรอยู่
    onProgress?.({ stage: "th", page });
    const thOcr = await new RapidOcrService().extractTextBoth(imagePath, "th");
    if (!thOcr) {
      console.warn("  [th-ocr] ✗ เครื่องอ่านไทยล้ม — คง best (ยังไม่ได้ challenge จริง)");
      return null;
    }
    const thai = thaiCharCount(thOcr.flat);
    const nonSpace = thOcr.flat.replace(/\s/g, "").length;
    const ratio = nonSpace ? thai / nonSpace : 0;
    // ใบไม่ใช่ไทย → ทิ้งตรงนี้ ไม่เผา LLM parse รอบใหม่ (ค่าใช้จ่ายจบที่ OCR pass เดียว)
    if (thai < TH_MIN_CHARS || ratio < TH_MIN_RATIO) return null;
    console.log(
      `  [th-ocr] เห็นอักษรไทย ${thai} ตัว (${(ratio * 100).toFixed(1)}% ของหน้า) → challenger ด้วยเครื่องอ่านไทย`
    );
    dumpDebug("_last-ocr-th.txt", thOcr.flat);
    const thGrid = GRID_LLM_ENABLED ? thOcr.grid : undefined;
    const thBest = await runFlatGridBest(
      filename, filePath, thOcr.flat, "rapidocr", page,
      thGrid, thGrid ? "spatial" : undefined, undefined
    );
    if (!gridBeatsFlat(thBest, best)) {
      // ★ หน้านี้เป็นไทยแน่ (ผ่านด่านอักษรมาแล้ว) แต่ keep-best ทิ้งเพราะมี FAIL ★
      //   best อ่านไทยไม่ออกอยู่แล้ว ปล่อยเงียบ = หน้าจอเห็นแต่แถวเขียว ส่วนแถวที่หลุดเกณฑ์หายไป
      if (thBest.summary.fail > 0 && sink) sink.hiddenFail = thBest.summary.fail;
      console.log(
        `  [th-ocr] ✗ เครื่องอ่านไทย ${passCount(thBest)}P/${thBest.summary.fail}F ไม่ชนะ best ${passCount(best)}P ขาด — คง best`
      );
      return null;
    }
    if (!thBest.product && best.product) thBest.product = best.product;
    if (!thBest.lotNo && best.lotNo) thBest.lotNo = best.lotNo;
    // เลขมาจาก OCR คนละ engine กับ best → ด่านเดียวกับ HQ: PASS ที่ best ยืนยันไม่ได้ ต้องไม่เขียว
    const thFlag = flagChallengerPasses(thBest, best, "rapidocr", thGrid ? "spatial" : undefined);
    for (const o of thFlag.overwritten) {
      console.warn(`  [th-ocr] ⚠ เครื่องอ่านไทยเขียนเลขทับแถวที่ best ผ่านอยู่แล้ว — ${o} · ปักธงให้คนตรวจ`);
    }
    if (thOcr.degraded) {
      for (const r of thBest.rows) r.needsReview = true;
      console.warn(
        `  [th-ocr] ⚠ ชนะแต่มาจากภาพย่อ ${thOcr.degraded.maxSide}px — ปักธงทั้ง ${thBest.rows.length} แถวให้ตรวจ`
      );
    }
    // ส่งข้อความไทยกลับไปหาป้าย product/lot — **เพิ่มตรงที่ default ว่าง ไม่ใช่เขียนทับ** (ดู runCoaPipeline)
    if (sink) sink.text = thOcr.flat;
    console.log(
      `  [th-ocr] ✓ เครื่องอ่านไทยชนะ ${passCount(best)}P→${passCount(thBest)}P (0 FAIL, PASS เดิมครบ) · needsReview +${thFlag.surfaced}`
    );
    return thBest;
  } catch (e) {
    console.warn("  [th-ocr] challenger error — คง best:", (e as Error).message);
    return null;
  }
}

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
  imagePath?: string,
  hqPrefetch?: ReturnType<RapidOcrService["extractTextBoth"]>,
  onProgress?: ProgressFn,
  thaiSink?: ThaiSink
): Promise<CoaReport> {
  const best = await runFlatGridBest(
    filename, filePath, text, engine, page, gridText, gridSource, gridOrient
  );

  // ★ Thai challenger ต้องมาก่อน HQ ★ — ใบไทยไม่ได้โผล่มาเป็น SKIP (ชื่อรายการหายทั้งคอลัมน์เงียบๆ)
  //   และ HQ ก็ dict ไม่มีไทยเหมือนกัน ยิงไปก็แพ้ → ชนะเมื่อไรจบเลย ไม่ต้องเผา HQ ต่ออีก ~35s
  if (OCR_TH_FALLBACK_ENABLED && engine === "rapidocr" && imagePath) {
    const thBest = await thaiChallenge(filename, filePath, page, imagePath, best, onProgress, thaiSink);
    if (thBest) return thBest;
  }

  // HQ challenger — เฉพาะ scanned (rapidocr) ที่ยังมี SKIP + มี imagePath ให้ re-OCR
  //   ไฟล์สะอาด (skip=0 เช่น Lot240521) ไม่ trigger → v5 ไม่ถูกโหลด/รัน = เท่าเดิม
  if (
    OCR_HQ_FALLBACK_ENABLED &&
    engine === "rapidocr" &&
    imagePath &&
    best.summary.skip > 0
  ) {
    // ยิงเฉพาะเมื่อมี SKIP ที่ OCR ดีขึ้นแล้วมีโอกาสหายจริง — text-only SKIP ข้าม (ดู skipMayBenefitFromHq)
    const worthy = best.rows.filter(
      (r) => r.status === "SKIP" && skipMayBenefitFromHq(r)
    );
    if (worthy.length === 0) {
      console.log(
        `  [hq-ocr] SKIP ทั้ง ${best.summary.skip} รายการเป็น text ล้วน (ไม่มีตัวเลขให้ OCR แก้) — ข้าม HQ challenger`
      );
      return best;
    }
    console.log(
      `  [hq-ocr] best ยังมี ${best.summary.skip} SKIP (${worthy.length} ตัวมีโอกาสหายจาก re-OCR) → HQ challenger (daemon HQ engine, default v5-server)`
    );
    onProgress?.({ stage: "hq", page });
    try {
      // ใช้ผล HQ OCR ที่สั่งไว้ล่วงหน้า (ดู runCoaPipeline) — ถ้าไม่มีก็ OCR ตรงนี้เหมือนเดิม
      const hqOcr = await (hqPrefetch ?? new RapidOcrService().extractTextBoth(imagePath, "hq"));
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
          // เลขของ HQ มาจาก OCR คนละ engine กับ best → ใช้ด่านเดียวกับ grid: PASS ที่ best ยืนยันไม่ได้ ต้องไม่เขียว
          const hqFlag = flagChallengerPasses(hqBest, best, "rapidocr", hqGrid ? "spatial" : undefined);
          for (const o of hqFlag.overwritten) {
            console.warn(`  [hq-ocr] ⚠ HQ เขียนเลขทับแถวที่ best ผ่านอยู่แล้ว — ${o} · ปักธงให้คนตรวจ`);
          }
          // ภาพย่อ = ครึ่งความละเอียดที่คลัง validate ไว้ → ไม่เชื่อทั้งหน้า ไม่ใช่แค่แถวที่เปลี่ยน
          if (hqOcr.degraded) {
            for (const r of hqBest.rows) r.needsReview = true;
            console.warn(
              `  [hq-ocr] ⚠ HQ ชนะแต่มาจากภาพย่อ ${hqOcr.degraded.maxSide}px — ปักธงทั้ง ${hqBest.rows.length} แถวให้ตรวจ`
            );
          }
          console.log(
            `  [hq-ocr] ✓ HQ ชนะ ${passCount(best)}P→${passCount(hqBest)}P (0 FAIL, PASS เดิมครบ) — ใช้ HQ · needsReview +${hqFlag.surfaced}`
          );
          return hqBest;
        }
        console.log(
          `  [hq-ocr] ✗ HQ ${passCount(hqBest)}P ไม่ชนะ best ${passCount(best)}P ขาด — คง best`
        );
      } else if (!hqOcr) {
        // แยกจากเคสอ่านได้น้อย: null = daemon/engine ล้ม (เช่น ORT จอง memory ไม่ได้) →
        // ใบนี้ไม่เคยถูก challenge จริง SKIP ที่เหลือจึงอาจกู้ได้ถ้าเครื่องว่างกว่านี้
        console.warn(`  [hq-ocr] ✗ HQ engine ล้ม — คง best (ยังไม่ได้ challenge จริง, recall อาจหาย)`);
      } else {
        console.warn(`  [hq-ocr] HQ OCR thin — คง best`);
      }
    } catch (e) {
      console.warn(`  [hq-ocr] HQ challenger error — คง best:`, (e as Error).message);
    }
  }
  return best;
}

// Entry point ของ pipeline — เรียกจากทั้ง HTTP route และ CLI (test-coa.ts)
// คืน CoaReport[] หนึ่งตัวต่อหน้า PDF (single-page/image = [1 report])
export async function runCoaPipeline(filePath: string, onProgress?: ProgressFn): Promise<CoaReport[]> {
  const filename = path.basename(filePath).replace(/^\d+-/, "");
  const pages = await extractTextPerPage(filePath, onProgress);
  // ★ HQ prefetch (perf) ★ — HQ OCR (CPU, ~10s) วิ่งขนานกับ LLM parse (GPU) ของหน้าเดียวกัน →
  //   พอถึงคิว HQ challenger ผลรออยู่แล้ว ไม่ต้องรอ OCR อีกรอบ.
  //   ★ JIT ต่อหน้า ★ ยิงตอนเริ่ม process หน้านั้น ไม่ใช่ยิงทุกหน้าพร้อมกันตอนเริ่มไฟล์ — daemon มี lock
  //   เดียว (default+HQ) → ยิงรวดเดียวทำให้หน้าที่ต้องใช้ HQ จริงไปต่อท้ายคิวของหน้าที่ไม่ได้ใช้ = ไม่ทันกิน
  //   ★ default ปิด — วัดจริงบน corpus (ROUND 20): เปิดแล้วช้าลง 329s→340s ★ hq stage ลง 93s→49s จริง
  //   แต่ ocr +18s / parse +33s: HQ engine (v5-server) กิน CPU จนเบียด Ollama เอง (LLM อยู่ GPU ก็ยังใช้
  //   CPU tokenize/sample) + เบียด default OCR ของไฟล์ถัดไป. คุ้มเฉพาะตอน daemon อยู่คนละเครื่อง (LAN)
  //   → COA_OCR_HQ_SPECULATE=true เปิดตอนนั้น
  const speculate = OCR_HQ_FALLBACK_ENABLED && process.env.COA_OCR_HQ_SPECULATE === "true";
  const hqSvc = speculate ? new RapidOcrService() : null;
  const reports: CoaReport[] = [];
  for (const pg of pages) {
    dumpDebug("_last-ocr.txt", pg.text); // debug, overwrite per page
    if (!pg.text.trim()) continue;        // skip blank pages (pinned)
    // หน้า scanned เท่านั้นที่ HQ challenger แตะได้ (ดู processPage) → หน้า text-layer ไม่ต้อง prefetch
    let hqPrefetch: ReturnType<RapidOcrService["extractTextBoth"]> | undefined;
    if (hqSvc && pg.engine === "rapidocr" && pg.imagePath) {
      hqPrefetch = hqSvc.extractTextBoth(pg.imagePath, "hq");
      hqPrefetch.catch(() => {}); // กัน unhandled rejection ตอนหน้านั้นไม่ได้ใช้ HQ
    }
    onProgress?.({ stage: "parse", page: pg.page, pages: pages.length });
    const thaiSink: ThaiSink = {};
    const report = await processPage(filename, filePath, pg.text, pg.engine, pg.page, pg.gridText, pg.gridSource, pg.gridOrient, pg.imagePath, hqPrefetch, onProgress, thaiSink);
    // ★ product/lot จากป้ายบนใบ ★ — ทำหลังเลือก candidate เสร็จ ให้หัวรายงานมีเจ้าของเดียว ไม่ขึ้นกับว่า
    //   flat/grid/HQ ตัวไหนชนะ. ไม่มีป้าย = null (LLM เดาชื่อลูกค้ามาใส่บ่อย ดู product-lot-recovery.ts)
    // ★ ข้อความ default เป็นเจ้าของหัวรายงานเหมือนเดิม ★ ข้อความไทยเติมเฉพาะช่องที่ default ว่าง
    //   (ใบสองภาษาที่ default อ่าน "Product Name" ได้สะอาด แต่ rec ไทยอ่านบรรทัดเดียวกันเพี้ยน — ห้ามเอาของเพี้ยนมาทับ)
    const header = recoverProductLot(pg.text);
    if (thaiSink.text) {
      const thHeader = recoverProductLot(thaiSink.text);
      header.product ??= thHeader.product;
      header.lotNo ??= thHeader.lotNo;
    }
    if (header.product !== report.product || header.lotNo !== report.lotNo) {
      console.log(
        `  [header] product ${report.product ?? "-"} → ${header.product ?? "-"} · lot ${report.lotNo ?? "-"} → ${header.lotNo ?? "-"}`
      );
    }
    report.product = header.product;
    report.lotNo = header.lotNo;
    // ★ ต้องปักธงตรงนี้ ที่รู้แล้วว่า candidate ไหนชนะ ★ ปักใน processPage จะหายถ้า HQ ชนะต่อทีหลัง
    //   หน้าไทยที่เครื่องอ่านไทยเจอค่าหลุดเกณฑ์ แต่ keep-best ทิ้งทั้งชุด (มี FAIL) — ปล่อยเขียวเงียบๆ
    //   = จอโชว์เฉพาะแถวที่ผ่าน แถวที่หลุดหายไปกับตา
    if (thaiSink.hiddenFail) {
      const note = `หน้านี้เป็นภาษาไทย เครื่องอ่านไทยเจอ ${thaiSink.hiddenFail} แถวหลุดเกณฑ์ — ต้องเทียบกับใบจริง`;
      for (const r of report.rows) {
        r.needsReview = true;
        r.reason = [r.reason, note].filter(Boolean).join(" · ");
      }
      console.warn(
        `  [th-ocr] ⚠ หน้าไทย: เครื่องอ่านไทยเจอ ${thaiSink.hiddenFail} แถวหลุดเกณฑ์ แต่ keep-best ทิ้ง — ปักธงทั้ง ${report.rows.length} แถว`
      );
    }
    reports.push(report);
  }
  onProgress?.({ stage: "eval" });

  // ★ cross-page reconciliation (DuPont multi-batch) ★ — ทำได้เฉพาะตรงนี้ที่เห็นครบทุกหน้าแล้ว
  //   หน้าหนึ่งอ่าน spec พลาดจะถูกหน้าอื่นค้าน (เคสจริง 1F1710 p3 Percent Moisture หยิบคอลัมน์ Batch)
  //   no-op สำหรับไฟล์หน้าเดียว / ไฟล์ที่ไม่ใช่ layout นี้
  const dupont = reconcileDupontSpecs(reports);
  if (dupont.greened > 0 || dupont.corrected.length > 0) {
    for (const c of dupont.corrected) {
      console.log(
        `  [dupont-xpage] page ${c.page} ${c.name}: spec ${c.from} → ${c.to} (${c.status}) — หน้าอื่นยืนยัน`
      );
    }
    for (const r of reports) r.summary = summarize(r.rows);
    console.log(
      `  [dupont-xpage] clean-green ${dupont.greened} แถว (หน้ายันกันเอง) · แก้ spec ${dupont.corrected.length} แถว`
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
