// ใบที่ช่อง Test Method ของบางแถวว่าง (Kemolit KF-3 แถว Foreign Particles) — OCR ไม่เว้นช่องว่างไว้
//   ช่องที่เหลือเลยเลื่อนซ้ายในสายตา LLM: เกณฑ์ "VISUAL" ไปนั่งช่องวิธีทดสอบ แล้วเกณฑ์ถูกคัดค่าผลมาแทน
import { RawCoaItem } from "./ollama-coa.service";
import { OcrToken } from "./rapidocr.service";
import { cx, clusterRows, rowNameKey } from "./ocr-grid";

export interface MethodShiftResult {
  fixed: { name: string; spec: string }[];
}

const METHOD_HEAD = /^test\s*method\.?$/i;
const SPEC_HEAD = /^specifications?\.?$/i;
const RESULT_HEAD = /^results?\.?:?$/i;
const UOM_HEAD = /^(?:uom|unit)\.?$/i;

interface Header {
  methodC: number;
  specC: number;
  resultC: number;
  uomC: number | null;
  y: number;
}

// หัวตาราง Test Method | Specification | (UOM) | Results ที่มีชุดเดียวทั้งหน้า — เจอซ้ำ = อ่านผิดตาราง
function findHeader(tokens: OcrToken[], medianH: number): Header | null {
  const one = (re: RegExp) => {
    const hits = tokens.filter((t) => re.test(t.text.trim()));
    return hits.length === 1 ? hits[0] : null;
  };
  const method = one(METHOD_HEAD);
  const spec = one(SPEC_HEAD);
  const result = one(RESULT_HEAD);
  if (!method || !spec || !result) return null;
  if (Math.abs(method.y - spec.y) > medianH || Math.abs(spec.y - result.y) > medianH) return null;

  const [methodC, specC, resultC] = [cx(method), cx(spec), cx(result)];
  if (!(methodC < specC && specC < resultC)) return null;

  const uom = one(UOM_HEAD);
  const uomC = uom && Math.abs(uom.y - spec.y) <= medianH ? cx(uom) : null;
  return { methodC, specC, resultC, uomC, y: Math.max(method.y2, spec.y2, result.y2) };
}

// ช่องที่ token ตกอยู่ — คืน null เมื่อมันอยู่ซ้ายของคอลัมน์วิธีทดสอบ (= ช่องลำดับ/ชื่อรายการ)
function bucketOf(t: OcrToken, h: Header): "method" | "spec" | "uom" | "result" | null {
  const anchors: { key: "method" | "spec" | "uom" | "result"; c: number }[] = [
    { key: "method", c: h.methodC },
    { key: "spec", c: h.specC },
    { key: "result", c: h.resultC },
  ];
  if (h.uomC != null) anchors.push({ key: "uom", c: h.uomC });

  const nameZone = h.methodC - (h.specC - h.methodC) * 0.5;
  if (cx(t) < nameZone) return null;
  return anchors.reduce((a, b) => (Math.abs(cx(t) - b.c) < Math.abs(cx(t) - a.c) ? b : a)).key;
}

const norm = (s: unknown): string => String(s ?? "").replace(/\s+/g, "").toLowerCase();

// ย้ายเกณฑ์ที่ไปนั่งช่องวิธีทดสอบกลับที่ของมัน — แตะเฉพาะแถวที่ช่องวิธีทดสอบบนใบว่างจริง
export function fixShiftedMethodCells(
  items: RawCoaItem[],
  tokens: OcrToken[] | undefined
): MethodShiftResult {
  const fixed: MethodShiftResult["fixed"] = [];
  if (!items?.length || !tokens?.length) return { fixed };

  const { rows, medianH } = clusterRows(tokens);
  const header = findHeader(tokens, medianH);
  if (!header) return { fixed };

  // ช่องซ้ายสุดเป็นลำดับที่ (1,2,3 / A,B) ไม่ใช่ชื่อรายการ — ตัดทิ้งก่อนจับคู่ ไม่งั้นชื่อไม่ตรงสักแถว
  const dataRows: { key: string; toks: OcrToken[] }[] = [];
  for (const r of rows) {
    if (r[0].y <= header.y) continue;
    const labels = r.filter((t) => bucketOf(t, header) === null).sort((a, b) => a.x - b.x);
    while (labels.length && /^(?:[0-9]{1,3}[.)]?|[A-Z])$/.test(labels[0].text.trim())) labels.shift();
    const key = rowNameKey(labels.map((t) => t.text).join(""));
    if (key.length >= 4) dataRows.push({ key, toks: r });
  }

  for (const it of items) {
    const method = String(it.method ?? "").trim();
    if (!method) continue;
    // ชื่อที่ OCR ตัดขึ้นบรรทัดใหม่จะสั้นกว่าของ LLM — ยอมให้ขึ้นต้นตรงกัน แต่ต้องตรงแถวเดียวเท่านั้น
    const itemKey = rowNameKey(it.name);
    if (itemKey.length < 4) continue;
    const hits = dataRows.filter((d) => d.key === itemKey || itemKey.startsWith(d.key) || d.key.startsWith(itemKey));
    if (hits.length !== 1) continue;
    const row = hits[0].toks;

    const cells = { method: [] as string[], spec: [] as string[] };
    for (const t of row) {
      const b = bucketOf(t, header);
      if (b === "method" || b === "spec") cells[b].push(t.text.trim());
    }
    // ★ อาการที่แก้ ★ ช่องวิธีทดสอบบนใบว่าง และข้อความที่ LLM เรียกว่า method คือของในช่องเกณฑ์
    if (cells.method.length) continue;
    const specCell = cells.spec.join(" ").trim();
    if (!specCell || norm(specCell) !== norm(method)) continue;

    it.specRaw = specCell;
    it.specMin = null;
    it.specMax = null;
    it.method = null;
    it.specFromCell = true;
    fixed.push({ name: String(it.name ?? ""), spec: specCell });
  }

  return { fixed };
}
