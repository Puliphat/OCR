// ใบที่ช่องเกณฑ์ 1 ช่องคร่อมหลายแถว (PAG-80: ตะแกรง 2 ช่วงใช้ช่อง 20.0~30.0 ร่วมกัน)
//   แถวบนของคู่จึงไม่มีเกณฑ์ให้เทียบทั้งที่ใบกำหนดไว้ — อ่านจากพิกัด token เพราะใบสแกนไม่มีเส้นตาราง
import { RawCoaItem } from "./ollama-coa.service";
import { OcrToken } from "./rapidocr.service";
import { NUM_PATTERN } from "./numeric";
import { cx, clusterRows, clusterColumns, rowNameKey } from "./ocr-grid";

export interface SharedSpecResult {
  shared: { name: string; spec: string; from: string }[];
}

const SPEC_HEAD = /^spec(?:ification)?s?\.?$/i;
const CLEAN_NUM = new RegExp(`^(${NUM_PATTERN})\\s*%?$`);

const isNumCell = (s: string): boolean => CLEAN_NUM.test(s.trim());

interface TableRow {
  y: number;
  label: string;
  hasResult: boolean;
  spec: string | null;
}

// อ่านตารางจาก token: ช่องชื่อ (ซ้ายสุด) · ช่องผล (คอลัมน์กลางที่เป็นตัวเลขมากสุด) · ช่องเกณฑ์ (ใต้หัว Spec)
function readTable(tokens: OcrToken[]): { rows: TableRow[]; pitch: number } | null {
  const heads = tokens.filter((t) => SPEC_HEAD.test(t.text.trim()));
  if (heads.length !== 1) return null; // หัว Spec ต้องมีชุดเดียว ไม่งั้นอ่านคนละตาราง
  const head = heads[0];

  const body = tokens.filter((t) => t.y > head.y2);
  if (body.length < 6) return null;

  const { rows, medianH } = clusterRows(body);
  const cols = clusterColumns(body, medianH);
  if (cols.length < 3) return null;

  const center = (c: { lo: number; hi: number }) => (c.lo + c.hi) / 2;
  const specCol = cols[cols.length - 1];
  if (Math.abs(center(specCol) - cx(head)) > 6 * medianH) return null;

  const labelCol = cols[0];
  const middle = cols.slice(1, -1);
  if (!middle.length) return null;
  const numCount = (c: { toks: OcrToken[] }) => c.toks.filter((t) => isNumCell(t.text)).length;
  const resultCol = middle.reduce((a, b) => (numCount(b) > numCount(a) ? b : a));
  if (numCount(resultCol) < 3) return null;

  const inCol = (t: OcrToken, c: { lo: number; hi: number }) =>
    cx(t) >= c.lo - medianH && cx(t) <= c.hi + medianH;

  const out: TableRow[] = [];
  for (const r of rows) {
    const labels = r.filter((t) => inCol(t, labelCol));
    if (!labels.length) continue;
    const specs = r.filter((t) => inCol(t, specCol));
    out.push({
      y: r[0].y,
      label: labels.map((t) => t.text.trim()).join(" "),
      hasResult: r.some((t) => inCol(t, resultCol) && isNumCell(t.text)),
      spec: specs.length ? specs.map((t) => t.text.trim()).join(" ").replace(/\s+/g, " ") : null,
    });
  }

  const gaps: number[] = [];
  for (let i = 1; i < out.length; i++) gaps.push(out[i].y - out[i - 1].y);
  gaps.sort((a, b) => a - b);
  return { rows: out, pitch: gaps.length ? gaps[Math.floor(gaps.length / 2)] : Infinity };
}

const hasSpec = (i: RawCoaItem): boolean =>
  !!String(i.specRaw ?? "").trim() ||
  String(i.specMin ?? "").trim() !== "" ||
  String(i.specMax ?? "").trim() !== "";

// เติมเกณฑ์ให้แถวที่ช่องเกณฑ์บนใบว่าง เพราะช่องของแถวล่างคร่อมขึ้นมาคลุมมันอยู่
//   ★ เติมเฉพาะแถวที่ติดกันจริง (ห่างไม่เกิน 1.5 เท่าของระยะแถวปกติ) และแถวล่างมีเกณฑ์ ★
export function applySharedSpecCells(
  items: RawCoaItem[],
  tokens: OcrToken[] | undefined
): SharedSpecResult {
  const shared: SharedSpecResult["shared"] = [];
  if (!items?.length || !tokens?.length) return { shared };

  const table = readTable(tokens);
  if (!table || table.rows.length < 3) return { shared };

  const byKey = new Map<string, RawCoaItem>();
  for (const it of items) {
    const k = rowNameKey(it.name);
    if (k && !byKey.has(k)) byKey.set(k, it);
  }

  // ไล่จากล่างขึ้นบน: แถวไม่มีเกณฑ์ยืมจากแถวใต้มัน — คร่อมกันหลายแถวติดกันก็ส่งต่อขึ้นไปได้
  let carry: { spec: string; from: string; y: number } | null = null;
  for (let i = table.rows.length - 1; i >= 0; i--) {
    const row = table.rows[i];
    if (row.spec != null) {
      carry = { spec: row.spec, from: row.label, y: row.y };
      continue;
    }
    if (!carry || !row.hasResult) {
      carry = null;
      continue;
    }
    if (carry.y - row.y > 1.5 * table.pitch) {
      carry = null;
      continue;
    }
    const it = byKey.get(rowNameKey(row.label));
    if (!it || hasSpec(it)) continue;

    it.specRaw = carry.spec;
    it.specMin = null;
    it.specMax = null;
    it.specFromCell = true;
    it.specShared = true;
    shared.push({ name: String(it.name ?? row.label), spec: carry.spec, from: carry.from });
  }

  return { shared };
}
