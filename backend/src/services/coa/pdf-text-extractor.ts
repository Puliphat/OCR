// ดึง text-layer จาก PDF โดยตรง (ใช้ pdfjs-dist) — ไม่ต้อง render เป็นภาพ + OCR
// PDF ส่วนใหญ่ที่ export จาก Word/Excel มี text-layer อยู่แล้ว ใช้ทางนี้เร็ว/แม่นกว่ามาก
import * as fs from "fs";
import * as path from "path";

const pdfjsDistPath = path.dirname(
  require.resolve("pdfjs-dist/package.json")
);

export interface PdfTextResult {
  text: string;
  hasUsableText: boolean;
  pageCount: number;
}

// จัด X-positions ของ token ทุกตัวในหน้า → หา column anchors ด้วย simple clustering
// Why: text-layer บน COA table มีช่องว่างกว้างระหว่าง column — join ด้วย space เดียว
//      ทำให้ LLM อ่านไม่ออกว่า column ไหนคือ specMin vs specMax vs result
// threshold clusterGap: ถ้า X ห่างกัน > 10 pt ถือว่าเป็น column ใหม่
function clusterXPositions(xs: number[], clusterGap = 10): number[] {
  if (!xs.length) return [];
  const sorted = [...xs].sort((a, b) => a - b);
  const anchors: number[] = [];
  let groupSum = sorted[0];
  let groupCount = 1;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= clusterGap) {
      groupSum += sorted[i];
      groupCount++;
    } else {
      anchors.push(groupSum / groupCount); // centroid ของ cluster
      groupSum = sorted[i];
      groupCount = 1;
    }
  }
  anchors.push(groupSum / groupCount);
  return anchors;
}

// หา anchor ที่ใกล้ที่สุดสำหรับ token x
function nearestAnchorIdx(x: number, anchors: number[]): number {
  let best = 0;
  let bestDist = Math.abs(x - anchors[0]);
  for (let i = 1; i < anchors.length; i++) {
    const d = Math.abs(x - anchors[i]);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// ประมวล 1 หน้าของ pdfjs doc → คืน lines array
async function extractPageLines(doc: any, pageNum: number): Promise<string[]> {
  const pageLines: string[] = [];
  const page = await doc.getPage(pageNum);
  const tc = await page.getTextContent();

  // รวบ token พร้อม x, y, width — width ใช้สำหรับ kerning-merge
  interface Token { str: string; x: number; y: number; width: number }
  const tokens: Token[] = [];
  for (const item of tc.items as any[]) {
    if (!item.str) continue;
    tokens.push({
      str: item.str,
      x: item.transform[4],
      y: Math.round(item.transform[5]),
      width: typeof item.width === "number" ? item.width : 0,
    });
  }

  if (!tokens.length) {
    page.cleanup();
    return pageLines;
  }

  // จัดกลุ่ม token เป็น rows ตาม Y (Δy > 2 = row ใหม่)
  const rows: Token[][] = [];
  let currentRow: Token[] = [tokens[0]];
  let lastY = tokens[0].y;
  for (let i = 1; i < tokens.length; i++) {
    if (Math.abs(tokens[i].y - lastY) > 2) {
      rows.push(currentRow);
      currentRow = [];
    }
    currentRow.push(tokens[i]);
    lastY = tokens[i].y;
  }
  if (currentRow.length) rows.push(currentRow);

  // หา column anchors จาก X ของทุก token ในหน้า
  const allX = tokens.map((t) => t.x);
  const anchors = clusterXPositions(allX, 10);
  const useColumns = anchors.length >= 2;

  for (const row of rows) {
    // เรียง token ซ้าย → ขวา
    row.sort((a, b) => a.x - b.x);

    // Kerning fix: ถ้า token ติดกัน (gap < 0.5pt) และทั้งคู่เป็น numeric chunk → merge
    // Why: PDF font kerning ทำให้เลขเดียวถูก split เป็น 2 tokens (e.g. "9" + "3" → "9 3")
    //      จำกัดเฉพาะ numeric เพื่อไม่ merge "Min." + "Spec." (คนละ column header)
    const isNumeric = (s: string) => /^[\d.,%\-+ºu°μ]+$/.test(s.trim());
    const merged: typeof row = [];
    for (const t of row) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        t.x - (prev.x + prev.width) < 0.5 &&
        isNumeric(prev.str) &&
        isNumeric(t.str)
      ) {
        prev.str = prev.str + t.str;
        prev.width = prev.width + t.width;
      } else {
        merged.push({ ...t });
      }
    }
    row.length = 0;
    row.push(...merged);

    if (!useColumns) {
      // fallback: single-column layout ใช้ space join เหมือนเดิม
      const line = row.map((t) => t.str).join(" ").trim();
      if (line) pageLines.push(line);
      continue;
    }

    // assign token แต่ละตัวเข้า column anchor ที่ใกล้ที่สุด
    const cols: Map<number, string[]> = new Map();
    for (const t of row) {
      const idx = nearestAnchorIdx(t.x, anchors);
      if (!cols.has(idx)) cols.set(idx, []);
      cols.get(idx)!.push(t.str);
    }

    // สร้าง line โดยเรียง column index → join ด้วย " | "
    const colIdxs = [...cols.keys()].sort((a, b) => a - b);
    const parts = colIdxs.map((idx) => cols.get(idx)!.join(" ").trim());
    // กรอง column ว่างออก แล้ว join ด้วย " | "
    const line = parts.filter(Boolean).join(" | ");
    if (line) pageLines.push(line);
  }

  page.cleanup();
  return pageLines;
}

// Per-page extraction — คืน array ของ {text, hasUsableText} ต่อหน้า + pageCount
// hasUsableText ต่อหน้า: text.replace(/\s/g,"").length >= 300
export async function extractPdfTextPerPage(
  filePath: string
): Promise<{ pages: { text: string; hasUsableText: boolean }[]; pageCount: number }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await getDocument({
    data,
    cMapUrl: path.join(pdfjsDistPath, "cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfjsDistPath, "standard_fonts/"),
    useSystemFonts: true,
  }).promise;

  const pages: { text: string; hasUsableText: boolean }[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const pageLines = await extractPageLines(doc, p);
    const text = pageLines.filter((l) => l.trim()).join("\n");
    pages.push({
      text,
      hasUsableText: text.replace(/\s/g, "").length >= 300,
    });
  }

  await doc.destroy();

  return { pages, pageCount: pages.length };
}

// อ่านทุกหน้า เรียงเป็น line ตาม Y-coordinate (Δy > 2 = ขึ้นบรรทัดใหม่)
// ถ้าตรวจพบ ≥ 2 column anchors → join ด้วย " | " แทน space เดียว
// hasUsableText = true เมื่อข้อความ (ไม่นับช่องว่าง) ≥ 300 chars
// (เดิม 100 chars — เจอ PR1950W มี text-layer 135 chars ผ่าน threshold แต่ LLM parse fail
//  เพราะ text sparse ไม่มี row table จริง ขยับเป็น 300 ให้ fallback ไป OCR แทน)
// backward-compat: เรียก extractPdfTextPerPage แล้ว join ทุกหน้า
export async function extractPdfText(filePath: string): Promise<PdfTextResult> {
  const { pages, pageCount } = await extractPdfTextPerPage(filePath);
  const text = pages.map((p) => p.text).filter(Boolean).join("\n");
  return {
    text,
    hasUsableText: text.replace(/\s/g, "").length >= 300,
    pageCount,
  };
}
