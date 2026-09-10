// ใบสไตล์ญี่ปุ่นที่พิมพ์เกณฑ์ไว้ในวงเล็บท้ายบรรทัด และมีค่าวัดหลายครั้งก่อนคอลัมน์ Average
//   (Nippon Steel Wool: "355μm on | 17.1 | 17.1 | 15.3 | 16.5 | (2~22)") — ค่าที่ใช้ตัดสินคือช่องก่อนวงเล็บ
import { RawCoaItem } from "./ollama-coa.service";
import { splitCells } from "./column-shift-recovery";
import { normalizeSpec } from "./spec-normalizer";
import { NUM_PATTERN, toNum } from "./numeric";

const PAREN_SPEC = /^\((.+)\)$/;
const LONE_NUM = new RegExp(`^(${NUM_PATTERN})\\s*%?$`);

export interface ParenSpecResult {
  items: RawCoaItem[];
  rows: number;
}

// OCR ชอบแทรกช่องว่างหลังจุด ("17. 1") — ต่อคืนก่อนเช็คว่าเป็นตัวเลขเดี่ยว
function joinDecimals(s: string): string {
  return s.replace(/(\d)\.\s+(\d)/g, "$1.$2").trim();
}

function asNumber(cell: string): number | null {
  const t = joinDecimals(cell);
  if (!LONE_NUM.test(t)) return null;
  const n = toNum(t.replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

function cleanName(cells: string[]): string {
  return cells
    .map((c) => c.trim())
    .filter((c) => c && !/^[:.()\s]*$/.test(c))
    .join(" ")
    .replace(/^\d+\s*\.\s*/, "")
    .replace(/\s*:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// อ่านทุกบรรทัดที่ลงท้ายด้วยเกณฑ์ในวงเล็บ + มีตัวเลขอยู่ก่อนหน้าอย่างน้อย 2 ช่อง (ค่าวัดหลายครั้ง)
export function recoverParenSpecRows(text: string): ParenSpecResult | null {
  if (!text) return null;
  // ใบต้องประกาศคอลัมน์ค่าเฉลี่ยของตัวเอง — ไม่มีคำนี้แปลว่าเดาว่าช่องก่อนวงเล็บคือค่าเฉลี่ย
  if (!/\b(average|mean|avg\.?)\b|平均/i.test(text)) return null;
  const items: RawCoaItem[] = [];

  for (const line of text.split("\n")) {
    const cells = splitCells(line);
    if (cells.length < 4) continue;

    const last = cells[cells.length - 1].trim();
    const m = last.match(PAREN_SPEC);
    if (!m) continue;
    const spec = joinDecimals(m[1]);
    if (!normalizeSpec(spec)) continue;

    const result = asNumber(cells[cells.length - 2]);
    if (result == null) continue;

    // ต้องมีค่าวัดอย่างน้อย 2 ช่องก่อนช่อง Average — กันบรรทัดธรรมดาที่บังเอิญมีวงเล็บท้าย
    const measures: number[] = [];
    let i = cells.length - 3;
    for (; i >= 0; i--) {
      const n = asNumber(cells[i]);
      if (n == null) break;
      measures.push(n);
    }
    if (measures.length < 2) continue;

    // ★ พิสูจน์ว่าช่องนั้นคือค่าเฉลี่ยจริง ★ ไม่ใช่ค่าวัดครั้งสุดท้ายที่บังเอิญอยู่ติดวงเล็บ
    const mean = measures.reduce((a, b) => a + b, 0) / measures.length;
    if (Math.abs(result - mean) > Math.max(0.15 * Math.abs(mean), 0.05)) continue;

    const name = cleanName(cells.slice(0, i + 1));
    if (!name) continue;
    items.push({ name, specRaw: spec, result, specFromCell: true });
  }

  return items.length >= 3 ? { items, rows: items.length } : null;
}
