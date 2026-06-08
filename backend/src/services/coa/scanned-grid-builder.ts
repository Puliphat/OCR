// Build a column-aligned grid text from RapidOCR tokens + pdfplumber vector geometry.
// Used for scanned PDFs whose PDF layer has vector ruling lines (e.g. SODA, PR1950W_4063)
// but no extractable text. Column edges from pdfplumber geometry; text from RapidOCR tokens.
import { OcrToken } from "./rapidocr.service";

export interface VectorGeom {
  colEdges: number[];                              // column boundary x in PDF points
  pageWidth: number;                               // PDF page width in points
  pageHeight: number;
  pageRotation: number;
  tableBbox: [number, number, number, number];     // [x0, y0, x1, y1] in PDF points
}

// Returns " | " delimited grid text (rows joined by \n) or null when blockers fire:
//   (1) correctionAngle !== 0 — RapidOCR was run on a rotated image; token coords don't match PDF points
//   (2) geom.pageRotation !== 0 — same reason
//   (3) colEdges.length < 4 — need ≥3 columns (4 edges)
export function buildScannedGrid(
  tokens: OcrToken[],
  geom: VectorGeom,
  imageWidth: number,
  correctionAngle: number
): string | null {
  if (correctionAngle !== 0) return null;
  if (geom.pageRotation !== 0) return null;
  if (!geom.colEdges || geom.colEdges.length < 4) return null;
  if (!tokens.length) return null;

  const scale = imageWidth / geom.pageWidth;

  // Scale PDF-point geometry to image pixels
  const scaledEdges = geom.colEdges.map((e) => e * scale);
  const bboxX0 = geom.tableBbox[0] * scale;
  const bboxX1 = geom.tableBbox[2] * scale;
  const bboxY0 = geom.tableBbox[1] * scale;
  const bboxY1 = geom.tableBbox[3] * scale;

  const nCols = scaledEdges.length - 1; // number of column bands between edges

  // Minimum column width (for near-edge abstain threshold)
  let minColW = Infinity;
  for (let i = 0; i < nCols; i++) minColW = Math.min(minColW, scaledEdges[i + 1] - scaledEdges[i]);
  const abstainTol = minColW * 0.03; // token center within 3% of any edge → abstain (ambiguous column)

  // Filter tokens within table bbox
  const inBbox = tokens.filter((t) => {
    const cx = (t.x + t.x2) / 2;
    return cx >= bboxX0 && cx <= bboxX1 && t.y >= bboxY0 && t.y <= bboxY1;
  });
  if (!inBbox.length) return null;

  // Assign token to column index (0..nCols-1); null = abstain
  function colOf(t: OcrToken): number | null {
    const cx = (t.x + t.x2) / 2;
    for (const edge of scaledEdges) {
      if (Math.abs(cx - edge) < abstainTol) return null;
    }
    // Tokens left of first edge are outside table — discard
    if (cx < scaledEdges[0]) return null;
    for (let i = 0; i < nCols; i++) {
      if (cx >= scaledEdges[i] && cx < scaledEdges[i + 1]) return i;
    }
    return nCols - 1; // right of last edge → rightmost col
  }

  // Row clustering (same gap logic as RapidOcrService.reconstructText)
  const heights = inBbox.map((t) => t.y2 - t.y1).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
  const rowGap = Math.max(8, 0.6 * medianH);

  const sortedByY = [...inBbox].sort((a, b) => a.y - b.y);
  const rowGroups: OcrToken[][] = [];
  let cur: OcrToken[] = [sortedByY[0]];
  let lastY = sortedByY[0].y;
  for (const t of sortedByY.slice(1)) {
    if (Math.abs(t.y - lastY) > rowGap) {
      rowGroups.push(cur);
      cur = [];
    }
    cur.push(t);
    lastY = t.y;
  }
  if (cur.length) rowGroups.push(cur);

  // Build grid rows: each row is an array of nCols cells
  const SEQ_RE = /^\d{1,2}\s+/; // leading item sequence number (e.g. "1 ", "12 ")
  const gridRows: string[] = [];
  for (const rowToks of rowGroups) {
    const cells: string[] = Array(nCols).fill("");
    for (const t of rowToks) {
      const col = colOf(t);
      if (col === null) continue;
      // col 0 = item name/seq# column — strip leading sequence numbers
      const text = col === 0 ? t.text.replace(SEQ_RE, "").trim() : t.text.trim();
      if (!text) continue;
      cells[col] = cells[col] ? cells[col] + " " + text : text;
    }
    if (cells.every((c) => !c)) continue; // skip fully empty rows
    gridRows.push(cells.join(" | "));
  }

  return gridRows.length ? gridRows.join("\n") : null;
}
