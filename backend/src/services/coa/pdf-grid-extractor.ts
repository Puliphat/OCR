// Structural table extraction for text-layer PDFs via pdfplumber (Python subprocess, NO torch).
//
// Why: the flatten step in coa-pipeline destroys column geometry — the LLM then can't tell
//   specMin vs specMax vs result (worst on transposed COAs where items are columns). pdfplumber
//   lines-strategy recovers the TRUE 2D cell-grid from the PDF's ruling lines, giving the LLM
//   column-correct input. Used as the keep-best "grid challenger" for text-layer pages.
//   ★ anti-regression: flat stays the floor; grid only kept when it strictly wins (see processPage) ★
//
// source = "lines"  → grid from real ruling lines (geometry-verified columns; trust higher)
//          "text"   → grid from text-alignment fallback (no ruling lines)
//          "none"   → no table recovered on this page
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

// Extract per-page structural grid from a PDF. Synchronous subprocess (one-shot, not on a hot
// path — runs once per PDF during extraction). Never throws: any failure → [] so the caller
// silently keeps the flat-only path (grid is an optional challenger, never required).
export function extractPdfGridPerPage(filePath: string): PdfGridPage[] {
  try {
    const res = spawnSync(PY, [SCRIPT, filePath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    if (res.error) {
      console.warn(`  [pdf-grid] spawn failed: ${res.error.message}`);
      return [];
    }
    if (res.status !== 0) {
      console.warn(
        `  [pdf-grid] pdfplumber exited ${res.status}: ${(res.stderr || "").slice(0, 200)}`
      );
      return [];
    }
    const parsed = JSON.parse(res.stdout) as {
      pages?: any[];
      error?: string;
    };
    if (parsed.error) {
      console.warn(`  [pdf-grid] ${parsed.error}`);
      return [];
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
  } catch (e) {
    console.warn(`  [pdf-grid] failed: ${(e as Error).message}`);
    return [];
  }
}
