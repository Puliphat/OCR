// ตารางที่ 1 บรรทัด = 1 ล็อต และเกณฑ์อยู่บรรทัด Specifications เหนือขึ้นไป (Suzorite Mica: หลายล็อตในใบเดียว)
//   LLM หยิบชื่อคอลัมน์จากหัวตารางมาเป็นชื่อแถวแล้วค่าเลื่อน → เคยได้ Humidity=26 เกณฑ์ 15~30 (ทั้งคู่ผิด)
import { RawCoaItem } from "./ollama-coa.service";
import { splitCells } from "./column-shift-recovery";
import { normalizeSpec } from "./spec-normalizer";

const SPEC_ROW = /^(spec(ification)?s?\.?|規格値?)$/i;
const LOT_ROW = /^lot\s*(no\.?|number)?\s*[:.]?\s*\S+/i;
// ใบที่วัดหลาย sample แล้วสรุปแถวเฉลี่ย (Vermitech) — ใบเขียนเองว่าตัดสินจากแถวนี้
const AVG_ROW = /^(平均|average|mean|avg\.?)$/i;
// ป้ายตะแกรง: "+100" "-325" "-60/+100" — ไม่ใช่เกณฑ์ (ไม่มี ~ และขึ้นต้นด้วยเครื่องหมาย)
const MESH_LABEL = /^[+\-−][0-9]+(?:\s*\/\s*[+\-−][0-9]+)?$/;
const MESH_GLUED = /[+\-−][0-9]+\s*\/\s*[+\-−][0-9]+/g;
const TEXT_SPEC = /^(traces?|absent|nil|none|n\/a)$/i;

function isSpecCell(c: string): boolean {
  const t = c.trim();
  if (!t) return false;
  if (TEXT_SPEC.test(t)) return true;
  if (MESH_LABEL.test(t)) return false;
  return normalizeSpec(t) != null;
}

// ป้ายที่ OCR ต่อกันเป็นก้อนเดียว ("-60/+100-100/+200") ต้องแยกคืนตามลำดับเดิม
function labelsIn(cell: string): string[] {
  const t = cell.trim();
  if (MESH_LABEL.test(t)) return [t];
  const glued = t.match(MESH_GLUED);
  return glued && glued.length >= 2 ? glued.map((g) => g.replace(/\s+/g, "")) : [];
}

// ชื่อคอลัมน์ท้ายที่ไม่ใช่ตะแกรง (Loose Bulk / Density / Humidity) — รวมคำจากซ้ายจนจำนวนช่องพอดี
function tailNames(headerCells: string[], need: number): string[] {
  const words = headerCells
    .slice(1)
    .map((c) => c.trim())
    .filter((c) => c && !/^sieve\s*analysis$/i.test(c));
  if (words.length < need) return [];
  while (words.length > need) words.splice(0, 2, `${words[0]} ${words[1]}`);
  return words;
}

// ตารางที่ชื่อคอลัมน์แยกอยู่ 2 บรรทัดเหนือแถวเกณฑ์ (Vermitech: ชื่อรายการบรรทัดหนึ่ง เลขตะแกรงอีกบรรทัด)
//   รวมสองบรรทัดแล้วต้องได้จำนวนชื่อเท่าจำนวนเกณฑ์พอดี ไม่งั้นถือว่าอ่านไม่ออก
function namesFromRowsAbove(lines: string[], specIdx: number, need: number): string[] | null {
  if (specIdx < 2) return null;
  const unitCells = splitCells(lines[specIdx - 1]).slice(1).map((c) => c.trim());
  const headCells = splitCells(lines[specIdx - 2]).slice(1).map((c) => c.trim());

  const sub = unitCells.filter((c) => /^\d+$/.test(c) || /^(pan|total)$/i.test(c));
  const main = headCells.filter(
    (c) => c && !/analysis|分布|mesh/i.test(c) && !/^[%\s]*$/.test(c)
  );
  const names = [...main, ...sub];
  return names.length === need ? names : null;
}

export interface LotRowTableResult {
  items: RawCoaItem[];
  lots: string[];
}

export function recoverLotRowTable(text: string): LotRowTableResult | null {
  if (!text) return null;
  const lines = text.split("\n");

  const specIdx = lines.findIndex((l) => SPEC_ROW.test(splitCells(l)[0]?.trim() ?? ""));
  const specLine = specIdx >= 0 ? lines[specIdx] : undefined;
  // ใบที่แจกแจงรายล็อตต้องแสดงครบทุกล็อต — ค่าเฉลี่ยใช้เฉพาะใบที่ไม่มีแถวล็อตเลย (Vermitech วัดหลาย
  //   ตัวอย่างของล็อตเดียว) ไม่งั้นล็อตที่หลุดเกณฑ์จะหายไปในค่าเฉลี่ยที่ผ่าน
  const lotOnly = lines.filter((l) => LOT_ROW.test(l.trim()));
  const avgLines = lines.filter((l) => AVG_ROW.test(splitCells(l)[0]?.trim() ?? ""));
  const lotLines = lotOnly.length ? lotOnly : avgLines;
  if (!specLine || lotLines.length === 0) return null;

  const specCells = splitCells(specLine).slice(1);
  const specs: string[] = [];
  const labels: string[] = [];
  let consumed = 0;
  for (const c of specCells) {
    const ls = labelsIn(c);
    if (ls.length) {
      labels.push(...ls);
      consumed++;
      continue;
    }
    if (isSpecCell(c)) {
      specs.push(c.trim());
      consumed++;
    }
  }
  if (specs.length < 3) return null;
  // ทุกช่องในบรรทัดเกณฑ์ต้องอ่านออกว่าเป็นเกณฑ์หรือป้าย — เหลือช่องที่อ่านไม่ออกแม้ช่องเดียวแปลว่า
  //   OCR ทำเกณฑ์หายไปหนึ่งช่อง แล้วการนับช่องที่เหลือจะจับคู่เลื่อนทั้งแถวโดยที่จำนวนยังเท่ากันพอดี
  if (consumed !== specCells.length) return null;

  // ทุกบรรทัดล็อตต้องมีจำนวนช่องเท่าเกณฑ์เป๊ะ — ไม่เท่า = จับคู่ไม่ได้ ปล่อยให้ LLM ว่าไป
  const lotRows: { lot: string; values: string[] }[] = [];
  for (const l of lotLines) {
    const cells = splitCells(l);
    const values = cells.slice(1).map((c) => c.trim());
    if (values.length !== specs.length) return null;
    lotRows.push({ lot: cells[0].trim().replace(/\s+/g, " "), values });
  }

  const headerLine = lines.find((l) => /^item\b/i.test(l.trim())) ?? "";
  const tail = tailNames(splitCells(headerLine), Math.max(0, specs.length - labels.length));
  let names = [...labels, ...tail];
  if (names.length !== specs.length) {
    const above = namesFromRowsAbove(lines, specIdx, specs.length);
    if (above) names = above;
  }

  const items: RawCoaItem[] = [];
  for (const { lot, values } of lotRows) {
    for (let i = 0; i < specs.length; i++) {
      const label = names[i] ?? `คอลัมน์ ${i + 1}`;
      items.push({
        name: lotRows.length > 1 ? `${lot} ${label}` : label,
        specRaw: specs[i],
        result: values[i],
        specFromCell: true,
      });
    }
  }
  return { items, lots: lotRows.map((r) => r.lot) };
}
