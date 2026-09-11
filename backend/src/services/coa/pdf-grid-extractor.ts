// Structural table extraction for text-layer PDFs via pdfplumber (Python subprocess, NO torch).
// Flattening loses column geometry (LLM confuses specMin/specMax/result); pdfplumber grid is the keep-best challenger.
// source = "lines" (real ruling lines, higher trust) | "text" (alignment fallback) | "none" (no table)
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

export interface PdfGridPage {
  page: number;
  grid: string;
  source: "lines" | "text" | "none" | "vector-geom";
  // pdf_table.py detects items-as-columns COAs and transposes them; "transposed" means it already
  // did so (grid is items-as-rows by here). Informational — the deterministic parser is orientation-
  // agnostic — but plumbed through so the parser/logs know the table was rotated.
  orient?: "normal" | "transposed";
  // scanned-vector geometry fields (only present when source === "vector-geom")
  colEdges?: number[];
  pageWidth?: number;
  pageHeight?: number;
  pageRotation?: number;
  tableBbox?: [number, number, number, number]; // [x0, y0, x1, y1] in PDF points
}

// locate ocr-py/ robustly under ts-node (src/) or compiled (dist/) — walk up for pdf_table.py
function findOcrPyDir(): string {
  if (process.env.OCR_PY_DIR) return process.env.OCR_PY_DIR;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, "ocr-py");
    if (fs.existsSync(path.join(cand, "pdf_table.py"))) return cand;
    dir = path.dirname(dir);
  }
  return path.join(__dirname, "..", "..", "..", "..", "ocr-py"); // best-effort fallback
}

const OCR_PY_DIR = findOcrPyDir();
const PY =
  process.env.OCR_PY_PYTHON ??
  path.join(OCR_PY_DIR, "venv", "Scripts", "python.exe");
const SCRIPT = path.join(OCR_PY_DIR, "pdf_table.py");

// ★ error code ที่ FE branch ได้ ★ — pdfplumber พัง = ผลตกเงียบ (ใบ text-layer ร่วงจาก 7P เหลือ 1P
//   เพราะไม่มี grid challenger) ซึ่งคือ failure mode เดียวกับ OCR fallback ที่ถอดทิ้งไปแล้ว
export const PDF_GRID_DOWN = "PDF_GRID_DOWN";

// Extract per-page structural grid from a PDF. Synchronous subprocess (one-shot, not on a hot path).
// ★ THROWS เมื่อ pdfplumber ทำงานไม่ได้ ★ — เดิม fail-soft คืน [] เงียบๆ ทำให้ผลตกโดยไม่มีใครรู้ (เคยร่วงพร้อมกัน 4 ใบ)
// "หน้านี้ไม่มีตาราง" (source="none") ไม่ใช่ error — pdfplumber ทำงานปกติ แค่ใบนี้ไม่มีเส้นตาราง
export function extractPdfGridPerPage(filePath: string): PdfGridPage[] {
  const res = spawnSync(PY, [SCRIPT, filePath], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (res.error) {
    throw new Error(
      `${PDF_GRID_DOWN}: เรียก pdfplumber ไม่ได้ (${res.error.message}) — ตรวจ venv ที่ ${PY} แล้วลองใหม่`
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `${PDF_GRID_DOWN}: pdfplumber จบด้วยรหัส ${res.status} — ${(res.stderr || "").slice(0, 200)}`
    );
  }
  let parsed: { pages?: any[]; error?: string };
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error(
      `${PDF_GRID_DOWN}: pdfplumber คืนค่าที่อ่านไม่ออก — ${(res.stdout || "").slice(0, 200)}`
    );
  }
  if (parsed.error) {
    throw new Error(`${PDF_GRID_DOWN}: pdfplumber แจ้ง error — ${parsed.error}`);
  }
  // Map Python snake_case fields → TS camelCase (vector-geom fields)
  return (parsed.pages ?? []).map((p: any): PdfGridPage => ({
    page: p.page,
    grid: p.grid ?? "",
    source: p.source ?? "none",
    orient: p.orient,
    colEdges: p.col_edges_pt,
    pageWidth: p.page_width,
    pageHeight: p.page_height,
    pageRotation: p.page_rotation,
    tableBbox: p.table_bbox,
  }));
}
