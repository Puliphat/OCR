// ใบสแกนที่หัวตาราง Spec แตกเป็น Min|Max ก่อนช่อง Results (HG-PP#180) — หัว 2 ชั้นถูก flatten
//   เป็นคนละบรรทัด LLM เลยสลับเกณฑ์กับผลทั้งใบ → อ่านใหม่จากพิกัด x ของ token แทนลำดับบรรทัด
import { RawCoaItem } from "./ollama-coa.service";
import { OcrToken } from "./rapidocr.service";
import { NUM_PATTERN } from "./numeric";

export interface MinMaxColumnsResult {
  fixed: { name: string; from: string; to: string }[];
}

const MIN_HEAD = /^min\.?$/i;
const MAX_HEAD = /^max\.?$/i;
const RESULT_HEAD = /^results?\.?$/i;
// ช่องเกณฑ์ที่ใบเขียนว่า "ไม่คุมด้านนี้" — ใบญี่ปุ่นใช้ 一 (CJK) ที่ OCR อ่านได้ตรงตัว
const DASH_CELL = /^[-–—−ー一_~]+$/;
const CLEAN_NUM = new RegExp(`^(${NUM_PATTERN})\\s*%?$`);

const cx = (t: OcrToken) => (t.x + t.x2) / 2;

// ชื่อรายการ/หัวข้อ — เก็บ CJK กับ μ ไว้ด้วย เพราะชื่อแถวจริงคือ "+150μm" / "-75μ血"
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9µμ぀-ヿ一-鿿]/g, "");
}

// จัด token เป็นแถวตาม y — กติกาเดียวกับ RapidOcrService.reconstructText (ปรับตาม DPI เอง)
function clusterRows(tokens: OcrToken[]): { rows: OcrToken[][]; medianH: number } {
  const heights = tokens.map((t) => t.y2 - t.y1).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
  const gap = Math.max(8, 0.6 * medianH);

  const sorted = [...tokens].sort((a, b) => a.y - b.y);
  const rows: OcrToken[][] = [];
  let cur: OcrToken[] = [sorted[0]];
  let lastY = sorted[0].y;
  for (const t of sorted.slice(1)) {
    if (Math.abs(t.y - lastY) > gap) {
      rows.push(cur);
      cur = [];
    }
    cur.push(t);
    lastY = t.y;
  }
  if (cur.length) rows.push(cur);
  return { rows, medianH };
}

interface Header {
  minC: number;
  maxC: number;
  resC: number;
  spacing: number; // ระยะคอลัมน์ที่แคบสุด — ใช้เป็นมาตรวัดว่า token ตกกลางช่องไหม
  y: number; // ขอบล่างของหัวตาราง — แถวข้อมูลต้องอยู่ใต้เส้นนี้
}

// หาหัวตาราง Min|Max|Results ที่ "มีชุดเดียวทั้งหน้า" — เจอซ้ำเมื่อไรแปลว่าอ่านผิดตาราง ถอยทันที
function findHeader(rows: OcrToken[][], medianH: number): Header | null {
  const all = rows.flat();
  const mins = all.filter((t) => MIN_HEAD.test(t.text.trim()));
  const maxs = all.filter((t) => MAX_HEAD.test(t.text.trim()));
  const ress = all.filter((t) => RESULT_HEAD.test(t.text.trim()));
  if (mins.length !== 1 || maxs.length !== 1 || ress.length !== 1) return null;

  const [min, max, res] = [mins[0], maxs[0], ress[0]];
  // Min กับ Max ต้องเป็นหัวคู่กันจริง (แถวเดียวกัน) · Results เป็นหัวชั้นบนได้ แต่ต้องอยู่ใกล้
  if (Math.abs(min.y - max.y) > medianH) return null;
  if (Math.abs(res.y - min.y) > 2 * medianH) return null;

  const [minC, maxC, resC] = [cx(min), cx(max), cx(res)];
  if (!(minC < maxC && maxC < resC)) return null;

  const spacing = Math.min(maxC - minC, resC - maxC);
  if (spacing < medianH) return null; // คอลัมน์ชิดกว่าความสูงตัวอักษร = ไม่ใช่ตารางที่แยกช่องได้

  return { minC, maxC, resC, spacing, y: Math.max(min.y2, max.y2, res.y2) };
}

interface RowCells {
  nameCells: string[];
  min: string | null;
  max: string | null;
  result: string | null;
}

// อ่าน 1 แถวเป็นช่อง — คืน null เมื่อมีเลขที่ตกคร่อมคอลัมน์ (พิสูจน์ไม่ได้ว่าเป็นช่องไหน)
function readRow(rowToks: OcrToken[], h: Header): RowCells | null {
  const nameZone = h.minC - h.spacing * 0.5;
  const sorted = [...rowToks].sort((a, b) => a.x - b.x);

  const nameToks = sorted.filter((t) => cx(t) < nameZone);
  const valueToks = sorted.filter((t) => cx(t) >= nameZone);

  // ชื่อรายการอาจมีป้ายกลุ่มนำหน้า ("Chemical Analysis  Fe") → แยกเป็นช่องตามช่องว่างกว้าง
  const nameCells: string[] = [];
  let prevRight = -Infinity;
  for (const t of nameToks) {
    if (t.x - prevRight > h.spacing * 0.5) nameCells.push(t.text.trim());
    else nameCells[nameCells.length - 1] += ` ${t.text.trim()}`;
    prevRight = t.x2;
  }

  const buckets: string[][] = [[], [], []];
  for (const t of valueToks) {
    const d = [Math.abs(cx(t) - h.minC), Math.abs(cx(t) - h.maxC), Math.abs(cx(t) - h.resC)];
    const near = d.indexOf(Math.min(...d));
    if (d[near] > h.spacing * 0.35) return null; // ตกคร่อมช่อง → ทั้งแถวเชื่อไม่ได้
    buckets[near].push(t.text.trim());
  }

  const cell = (parts: string[]): string | null => {
    const s = parts.join(" ").trim();
    if (!s || DASH_CELL.test(s)) return null;
    const m = s.match(CLEAN_NUM);
    return m ? m[1] : s; // ไม่ใช่เลขสะอาด → คืนข้อความไว้ให้ caller ปฏิเสธแถว
  };

  return { nameCells, min: cell(buckets[0]), max: cell(buckets[1]), result: cell(buckets[2]) };
}

const isNum = (s: string | null): boolean => s != null && CLEAN_NUM.test(s);

// ชื่อจาก LLM ตรงกับช่องชื่อของแถวนี้ไหม — ป้ายกลุ่มอาจติดมาในช่องเดียวกันจึงยอมให้ลงท้ายตรงกัน
function rowMatchesItem(cells: string[], itemKey: string): boolean {
  return cells.some((c) => {
    const k = nameKey(c);
    if (!k) return false;
    return k === itemKey || (itemKey.length >= 2 && k.endsWith(itemKey));
  });
}

// เขียนทับ spec/result ของ item ที่จับคู่แถวได้ — mutate in place, คืนเฉพาะรายการที่ค่าเปลี่ยนจริง
//   ถอยเงียบทุกชั้นที่พิสูจน์ไม่ได้ (ไม่เจอหัวตาราง / ชื่อซ้ำ / เลขคร่อมช่อง) = ใบอื่นไม่ถูกแตะ
export function recoverMinMaxColumns(
  items: RawCoaItem[],
  tokens: OcrToken[] | undefined
): MinMaxColumnsResult {
  const fixed: MinMaxColumnsResult["fixed"] = [];
  if (!items?.length || !tokens?.length) return { fixed };

  const { rows, medianH } = clusterRows(tokens);
  const header = findHeader(rows, medianH);
  if (!header) return { fixed };

  const dataRows = rows
    .filter((r) => r[0].y > header.y)
    .map((r) => readRow(r, header))
    .filter((r): r is RowCells => r != null && isNum(r.result) && (isNum(r.min) || isNum(r.max)));

  for (const it of items) {
    const key = nameKey(String(it.name ?? ""));
    if (!key) continue;

    const hits = dataRows.filter((r) => rowMatchesItem(r.nameCells, key));
    if (hits.length !== 1) continue; // ไม่เจอ/เจอหลายแถว = จับคู่ไม่ได้ ปล่อยผลเดิมของ LLM

    const row = hits[0];
    const lo = isNum(row.min) ? row.min : null;
    const hi = isNum(row.max) ? row.max : null;
    if (lo != null && hi != null && Number(lo) > Number(hi)) continue; // ซ้ายต้องเป็นขอบล่างตามหัวตาราง

    const before = `${it.specMin ?? "-"}~${it.specMax ?? "-"} ผล ${it.result ?? "-"}`;
    const after = `${lo ?? "-"}~${hi ?? "-"} ผล ${row.result}`;
    if (before === after) continue;

    it.specMin = lo;
    it.specMax = hi;
    it.specRaw = null; // ให้ทิศมาจากคอลัมน์ (ดู normalizeSpecFromCandidate) ไม่ใช่จากข้อความที่ LLM เดา
    it.result = row.result;
    it.resultMin = null;
    it.resultMax = null;
    it.specFromCell = true;
    fixed.push({ name: String(it.name), from: before, to: after });
  }

  return { fixed };
}
