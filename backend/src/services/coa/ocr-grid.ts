// ตัวช่วยอ่านตารางจากพิกัด token ของ OCR — ใบสแกนไม่มีเส้นตาราง ต้องจัดแถว/คอลัมน์จาก x,y เอง
import { OcrToken } from "./rapidocr.service";

export const cx = (t: OcrToken) => (t.x + t.x2) / 2;

// จัด token เป็นแถวตาม y — กติกาเดียวกับ RapidOcrService.reconstructText (ปรับตามความสูงตัวอักษรจริง)
export function clusterRows(tokens: OcrToken[]): { rows: OcrToken[][]; medianH: number } {
  const heights = tokens.map((t) => t.y2 - t.y1).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
  const gap = Math.max(8, 0.6 * medianH);

  const sorted = [...tokens].sort((a, b) => a.y - b.y);
  const rows: OcrToken[][] = [];
  let cur: OcrToken[] = [];
  let lastY = -Infinity;
  for (const t of sorted) {
    if (cur.length && Math.abs(t.y - lastY) > gap) {
      rows.push(cur);
      cur = [];
    }
    cur.push(t);
    lastY = t.y;
  }
  if (cur.length) rows.push(cur);
  return { rows, medianH };
}

// จับ token เป็นคอลัมน์ตามแกน x — ใช้กับใบที่ไม่มีหัวตารางครบทุกคอลัมน์
export function clusterColumns(
  tokens: OcrToken[],
  medianH: number
): { lo: number; hi: number; toks: OcrToken[] }[] {
  const sorted = [...tokens].sort((a, b) => cx(a) - cx(b));
  const cols: { lo: number; hi: number; toks: OcrToken[] }[] = [];
  for (const t of sorted) {
    const last = cols[cols.length - 1];
    if (last && cx(t) - last.hi <= 2 * medianH) {
      last.hi = Math.max(last.hi, cx(t));
      last.toks.push(t);
    } else {
      cols.push({ lo: cx(t), hi: cx(t), toks: [t] });
    }
  }
  return cols;
}

// ชื่อรายการสำหรับจับคู่ item กับแถวบนใบ — ทิ้งช่องว่าง/วรรคตอนที่ OCR กับ LLM สะกดไม่ตรงกัน
export function rowNameKey(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9µμ]/g, "");
}
