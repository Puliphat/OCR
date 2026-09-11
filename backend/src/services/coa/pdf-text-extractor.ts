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
//   text-layer บน COA table join ด้วย space เดียวทำ column ติดกัน → LLM อ่านไม่ออกว่าช่องไหนคือ specMin/specMax/result
//   threshold clusterGap: X ห่างกัน > 10 pt ถือว่าเป็น column ใหม่
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

// อักขระที่ยอมรับได้ใน COA: latin, CJK, สัญลักษณ์หน่วย/เกณฑ์ที่เจอจริง — นอกเหนือจากนี้ = decode เพี้ยน
const READABLE_CHAR =
  /[\x20-\x7E　-ヿ一-鿿＀-￯°±≤≥≦≧µμ®²³‘’“”–—′″]/;
// numeric token ที่ฟอร์แมตถูก เช่น 42.7 · <0.01 · ±2 · 99%
const CLEAN_NUMBER = /^[<>≤≥≦≧+±-]?\d+(?:[.,]\d+)?%?$/;

// PDF บางใบฝัง font ที่ไม่มี ToUnicode map → pdfjs ถอดได้แต่ตัวอักษรเลื่อนรหัส และตัวเลข
// หายเกลี้ยง (CERTIFICATE → &(57,),&$7(). ปล่อยผ่าน = LLM ได้ตารางไม่มีเลขแล้วแต่งค่าเอง
function looksDecodable(text: string): boolean {
  const dense = text.replace(/\s/g, "");
  if (!dense) return false;

  const unreadable = [...dense].filter((c) => !READABLE_CHAR.test(c)).length;
  if (unreadable / dense.length > 0.1) return false;

  // มีตัวเลขอยู่แต่ไม่มี token ไหนอ่านเป็นจำนวนได้เลย = glyph เลื่อน ไม่ใช่ใบที่ไม่มีค่าวัด
  const hasDigits = /\d/.test(dense);
  const cleanNumbers = text.split(/[\s|]+/).filter((t) => CLEAN_NUMBER.test(t)).length;
  return !hasDigits || cleanNumbers > 0;
}

// ★ ภาพคลุมทั้งหน้า = สแกนที่เครื่องฝัง OCR ไว้ ★ — text-layer แบบนี้เป็นผลของ OCR ตัวอื่น
//   ไม่ใช่ข้อความจริงของเอกสาร วัดแล้ว: HG-PP#180 = 1.00 · ใบ text-layer จริงทุกใบในคลัง ≤ 0.017
const FULL_PAGE_IMAGE = 0.8;

function mulMatrix(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

// สัดส่วนพื้นที่ของภาพใหญ่สุดในหน้า เทียบกับขนาดหน้า (0 = ไม่มีภาพ, 1 = เต็มหน้า)
async function largestImageCoverage(page: any, OPS: any): Promise<number> {
  let ops;
  try {
    ops = await page.getOperatorList();
  } catch {
    return 0; // อ่าน operator ไม่ได้ → ถือว่าไม่มีภาพ คงพฤติกรรมเดิม
  }
  const [x0, y0, x1, y1] = page.view;
  const pageArea = Math.abs((x1 - x0) * (y1 - y0)) || 1;
  const paints = new Set(
    [OPS?.paintImageXObject, OPS?.paintJpegXObject, OPS?.paintImageMaskXObject].filter(
      (v) => v !== undefined
    )
  );
  let m = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let best = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS?.save) stack.push(m.slice());
    else if (fn === OPS?.restore) m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS?.transform) m = mulMatrix(m, ops.argsArray[i]);
    else if (paints.has(fn)) {
      // ภาพถูกวาดในกรอบ 1x1 แล้วถูกยืดด้วย matrix → พื้นที่จริง = |det|
      best = Math.max(best, Math.abs(m[0] * m[3] - m[1] * m[2]) / pageArea);
    }
  }
  return best;
}

// Per-page extraction — คืน array ของ {text, hasUsableText} ต่อหน้า + pageCount
// hasUsableText ต่อหน้า: ยาว >= 300 chars, decode ออกจริง (looksDecodable) และไม่ใช่ภาพสแกนเต็มหน้า
export async function extractPdfTextPerPage(
  filePath: string
): Promise<{ pages: { text: string; hasUsableText: boolean }[]; pageCount: number }> {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
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
    let usable = text.replace(/\s/g, "").length >= 300 && looksDecodable(text);
    if (usable) {
      const cov = await largestImageCoverage(await doc.getPage(p), OPS);
      if (cov >= FULL_PAGE_IMAGE) {
        console.log(
          `  [text-layer] page ${p}: ภาพคลุมหน้า ${(cov * 100).toFixed(0)}% — text-layer มาจากสแกนเนอร์ ใช้ OCR แทน`
        );
        usable = false;
      }
    }
    pages.push({ text, hasUsableText: usable });
  }

  await doc.destroy();

  return { pages, pageCount: pages.length };
}

// อ่านทุกหน้า เรียงเป็น line ตาม Y-coordinate, ตรวจพบ ≥2 column anchors → join ด้วย " | " แทน space เดียว
// hasUsableText = true เมื่อข้อความ ≥ 300 chars (ไม่นับช่องว่าง) และ decode ออกจริง (เดิม 100 — PR1950W หลอก threshold)
// backward-compat: เรียก extractPdfTextPerPage แล้ว join ทุกหน้า
export async function extractPdfText(filePath: string): Promise<PdfTextResult> {
  const { pages, pageCount } = await extractPdfTextPerPage(filePath);
  const text = pages.map((p) => p.text).filter(Boolean).join("\n");
  return {
    text,
    hasUsableText: text.replace(/\s/g, "").length >= 300 && looksDecodable(text),
    pageCount,
  };
}
