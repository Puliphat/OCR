// ★ Deterministic structural-grid parser — root fix for text-layer column-role mapping ★
// Why: qwen3:4b misreads shifted columns (e.g. Suzorite) — classify each cell by CONTENT instead, no LLM.
// ★ SAFETY ★ Gated by keep-best (kept only if it beats the flat PASS set); ABSTAINS to SKIP instead of guessing a role.
import { RawCoa, RawCoaItem } from "./ollama-coa.service";

export type GridOrient = "normal" | "transposed";

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
// range "1~8" / "92~100" / "11.0~16.0" / "275-425"; tolerance "26 ± 2"
const RANGE_RE = new RegExp(`^${NUM}\\s*[~–—-]\\s*${NUM}$`);
const TOL_RE = new RegExp(`^${NUM}\\s*(?:±|\\+/-|\\+-)\\s*${NUM}$`);
// a lone measured value (result) or single-sided numeric — optional comparator + optional %
const BARE_RE = new RegExp(`^[<>≤≦≥≧]?\\s*${NUM}\\s*%?$`);
// mesh designation: "+100", "-100/+200", "-325" — part of the item NAME, never a spec/result
const MESH_RE = /^[+\-]\s*\d+(?:\s*\/\s*[+\-]\s*\d+)?$/;
const METHOD_RE = /\b(?:ASTM|ISO|JIS|USP|AOAC|EN|DIN|GB|TIS)\b|method/i;

// normalize fullwidth / CJK glyphs to ASCII so the predicates and the downstream normalizers agree
function nrm(c: string | undefined): string {
  return (c ?? "")
    .replace(/＋/g, "+")
    .replace(/[～〜∼]/g, "~")
    .replace(/％/g, "%")
    .replace(/＜/g, "<")
    .replace(/＞/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// EU decimal (0,28 → 0.28) vs US thousands (1,000 → 1000) — sync with spec/result normalizers
function toNum(s: string): number {
  let c = s.trim();
  if (c.includes(",") && !c.includes(".")) c = c.replace(/,/g, ".");
  else c = c.replace(/,/g, "");
  return Number(c);
}

function isMesh(c: string): boolean {
  return MESH_RE.test(nrm(c));
}

// a lone measured value — excludes mesh designations ("-325" is a mesh fraction, not a result)
function isBare(c: string): boolean {
  const s = nrm(c);
  if (!s || isMesh(s)) return false;
  return BARE_RE.test(s);
}

function isMethod(c: string): boolean {
  return METHOD_RE.test(c);
}

function isUnitCell(c: string): boolean {
  const s = nrm(c);
  return /^[(（].*[)）]$/.test(s) && classifySpec(s) === null && !isBare(s);
}

function unitText(c: string): string | null {
  return nrm(c).replace(/^[(（]\s*/, "").replace(/\s*[)）]$/, "").trim() || null;
}

interface SpecCells {
  specRaw?: string;
  specMin?: number;
  specMax?: number;
}

// classify ONE cell as a spec, or null. range/tolerance → verbatim specRaw; bound → numeric min/max.
function classifySpec(c: string): SpecCells | null {
  const s = nrm(c);
  if (!s) return null;
  if (RANGE_RE.test(s) || TOL_RE.test(s)) return { specRaw: s };
  // word-first "Max 5" / "Min 1"
  let m = s.match(new RegExp(`^(max|min)\\.?\\s*(${NUM})$`, "i"));
  if (m) return m[1].toLowerCase() === "max" ? { specMax: toNum(m[2]) } : { specMin: toNum(m[2]) };
  // number-first "5 Max" / "99 Min"
  m = s.match(new RegExp(`^(${NUM})\\s*(max|min)\\.?$`, "i"));
  if (m) return m[2].toLowerCase() === "max" ? { specMax: toNum(m[1]) } : { specMin: toNum(m[1]) };
  // symbol bounds: ≤ ≦ <= < (upper) · ≥ ≧ >= > (lower)
  m = s.match(new RegExp(`^(?:≤|≦|<=|<)\\s*(${NUM})$`));
  if (m) return { specMax: toNum(m[1]) };
  m = s.match(new RegExp(`^(?:≥|≧|>=|>)\\s*(${NUM})$`));
  if (m) return { specMin: toNum(m[1]) };
  // suffix ญี่ปุ่น (試験成績表 คอลัมน์ 規格値): "50以下" = ไม่เกิน 50 → upper · "94以上" = ไม่ต่ำกว่า 94 → lower
  m = s.match(new RegExp(`^(${NUM})\\s*(以下|以上)$`));
  if (m) return m[2] === "以下" ? { specMax: toNum(m[1]) } : { specMin: toNum(m[1]) };
  return null;
}

// ดึงเลขนำหน้าของ limit cell คอลัมน์เดียว (ตัด unit suffix "4.32g/cm3","93%" ทิ้ง)
// ไม่มีเลขนำ → null → row ABSTAIN เป็น SKIP ตรงๆ
function numOrNull(c: string): number | null {
  const s = nrm(c);
  if (!s) return null;
  const m = s.match(/^-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  return toNum(m[0]);
}

interface HeaderRoles {
  nameIdx: number;
  methodIdx: number;
  unitIdx: number;
  lowerIdx: number;
  upperIdx: number;
  resultIdx: number;
}

// header ที่แยกคอลัมน์ Lower/Upper-limit + Result — เคสเดียวที่ content parser แยกไม่ได้ (spec เป็น bare 2 คอลัมน์)
// ต้องมี lower+upper+result คนละคอลัมน์ครบ 3 ไม่งั้น null → ตกไป content path (Suzorite/PR1950W)
function detectSeparateLimitHeader(headerCells: string[]): HeaderRoles | null {
  const find = (re: RegExp) => headerCells.findIndex((c) => re.test(nrm(c)));
  const lowerIdx = find(/\b(lower|min)\b/i);
  const upperIdx = find(/\b(upper|max)\b/i);
  const resultIdx = find(/\banaly[sz]is\b|\bresults?\b|\bmeasured\b|\bactual\b|\bfound\b|test\s*result/i);
  if (lowerIdx < 0 || upperIdx < 0 || resultIdx < 0) return null;
  if (new Set([lowerIdx, upperIdx, resultIdx]).size < 3) return null; // ต้องคนละคอลัมน์
  const nameIdx = find(/\b(characteristic|item|parameter|property|component|description|test\s*item)\b/i);
  const methodIdx = find(/\bmethod\b/i);
  const unitIdx = find(/\bunit\b/i);
  return {
    nameIdx: nameIdx >= 0 ? nameIdx : 0,
    methodIdx,
    unitIdx,
    lowerIdx,
    upperIdx,
    resultIdx,
  };
}

// parse layout Lower/Upper-limit แยกคอลัมน์ — role เป็น index ตายตัวจาก header ความกำกวมหาย
// limit cell ไม่ใช่เลข → bound null (ABSTAIN เป็น SKIP)
function parseSeparateLimitGrid(
  dataRows: string[][],
  roles: HeaderRoles,
  lotNo: string | null
): RawCoa {
  const items: RawCoaItem[] = [];
  let section = "";
  for (const row of dataRows) {
    const nameCell = nrm(row[roles.nameIdx] ?? "");
    if (nameCell && !isMesh(nameCell)) section = nameCell;
    const name = nameCell && !isMesh(nameCell) ? nameCell : section;
    if (!name) continue;

    const specMin = numOrNull(row[roles.lowerIdx] ?? "");
    const specMax = numOrNull(row[roles.upperIdx] ?? "");
    const resultRaw = nrm(row[roles.resultIdx] ?? "");
    const methodCell = roles.methodIdx >= 0 ? nrm(row[roles.methodIdx] ?? "") : "";
    const unitCell = roles.unitIdx >= 0 ? nrm(row[roles.unitIdx] ?? "") : "";

    // ABSTAIN: ทิ้ง spacer / header ที่หลุดมา (ไม่มีทั้ง spec และ result)
    if (specMin == null && specMax == null && !resultRaw) continue;

    items.push({
      name,
      unit: unitCell ? unitText(unitCell) ?? unitCell : null,
      method: methodCell || null,
      specRaw: null,
      specMin,
      specMax,
      result: resultRaw || null,
    });
  }
  return { product: null, lotNo, items };
}

// pdfplumber วาง header (merged/centered) เลื่อนขว่าจาก data ทำ role index เพี้ยน (เคส Barimite)
// ตัด leading-empty ส่วนเกินของ header ให้ตรง data · header[0] มีค่าอยู่แล้ว = no-op (Z99 ไม่โดน)
function alignHeaderToData(header: string[], dataRows: string[][]): string[] {
  const lead = (r: string[]): number => {
    let n = 0;
    while (n < r.length && !nrm(r[n])) n++;
    return n;
  };
  const hLead = lead(header);
  if (hLead === 0 || dataRows.length === 0) return header;
  const dLeads = dataRows.map(lead).sort((a, b) => a - b);
  const dLead = dLeads[Math.floor(dLeads.length / 2)]; // median leading-empty ของ data rows
  const shift = hLead - dLead;
  if (shift <= 0) return header;
  const shifted = header.slice(shift);
  while (shifted.length < header.length) shifted.push("");
  return shifted;
}

function splitGrid(gridText: string): string[][] {
  const rows = (gridText ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("|").map((c) => nrm(c)))
    .filter((cells) => cells.some((c) => c !== ""));
  if (rows.length === 0) return rows;
  const ncol = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => (r.length < ncol ? [...r, ...Array(ncol - r.length).fill("")] : r));
}

// หัวตารางญี่ปุ่น: 試験項目 (รายการทดสอบ) · 検査項目 (รายการตรวจ) · 規格値 (เกณฑ์) · 実測値/測定値 (ค่าที่วัดได้)
//   · 合否判定 (ผลตัดสิน) · 備考 (หมายเหตุ). ใบญี่ปุ่นเว้นวรรคระหว่างตัวอักษรเพื่อจัดหน้า ("試 験 項 目")
//   → ต้องลบ whitespace ก่อนเทียบ ไม่งั้นไม่ match
const CJK_HEADER_RE = /試験項目|検査項目|規格値|実測値|測定値|合否判定|備考|品名/;

// a row is a HEADER when it carries no spec cell, no data number, and at least one header keyword.
function isHeaderRow(r: string[]): boolean {
  if (r.some((c) => classifySpec(c)) || r.some((c) => isBare(c))) return false;
  if (r.some((c) => CJK_HEADER_RE.test(nrm(c).replace(/\s+/g, "")))) return true;
  return r.some((c) => /^(item|method|spec|lot|parameter|test|result|unit|standard|grade|no\.?)\b/i.test(c));
}

// Result column lives at a fixed (but unknown) index — find it once globally so per-row spec search
// can exclude it. Score each column by how many rows hold a lone number THERE while also having a
// spec cell elsewhere (a result co-occurs with a spec on its row). argmax, ties → rightmost.
function resolveResultCol(dataRows: string[][], ncol: number): number {
  const score = new Array(ncol).fill(0);
  for (const row of dataRows) {
    const hasSpec = row.some((c) => classifySpec(c));
    if (!hasSpec) continue;
    for (let j = 0; j < row.length; j++) if (isBare(row[j])) score[j]++;
  }
  let best = -1;
  let bestScore = 1; // require ≥2 rows of evidence to lock a column
  for (let j = ncol - 1; j >= 0; j--) {
    if (score[j] > bestScore) {
      bestScore = score[j];
      best = j;
    }
  }
  if (best >= 0) return best;
  // fallback (small / unscored grids): rightmost column with any bare number
  for (let j = ncol - 1; j >= 0; j--) {
    if (dataRows.some((row) => isBare(row[j]))) return j;
  }
  return ncol - 1;
}

// หาคอลัมน์ spec หลัก — คอลัมน์ที่ classifySpec hit มากสุด (ไม่รวม resultCol)
// คืน -1 ถ้าไม่พบหลักฐาน (grid ไม่มี spec cell เลย)
function resolveSpecCol(
  dataRows: string[][],
  ncol: number,
  resultCol: number,
  skipCols: ReadonlySet<number> = new Set()
): number {
  const score = new Array(ncol).fill(0);
  for (const row of dataRows) {
    for (let j = 0; j < row.length; j++) {
      if (j === resultCol || skipCols.has(j)) continue;
      if (classifySpec(row[j])) score[j]++;
    }
  }
  let best = -1;
  let bestScore = 0; // ต้องมีอย่างน้อย 1 hit
  for (let j = 0; j < ncol; j++) {
    if (score[j] > bestScore) { bestScore = score[j]; best = j; }
  }
  return best;
}

// ★ sub-label column (merged-group layout) ★ — col0 เป็นชื่อกลุ่มครอบหลายแถว มีคอลัมน์แยกแถวจริง (เช่น D50/D90)
//   gate 5 ชั้น กันหลุดไปโดนใบทรงอื่น (เคย false-positive ดูดคอลัมน์ Unit เข้าชื่อ กลายเป็น SKIP ปลอม)
//   คืน -1 = ไม่มี sub-label column → ชื่อเป็นพฤติกรรมเดิมเป๊ะ
function resolveSubLabelCol(
  dataRows: string[][],
  ncol: number,
  resultCol: number,
  specCol: number
): number {
  // (1) merged-group จริง = แถวที่ไม่มีชื่อของตัวเอง แต่มี spec (แถวข้อมูลที่สืบชื่อจากด้านบน)
  const hasMergedDataRow = dataRows.some(
    (r) => !nrm(r[0] ?? "") && r.some((c) => classifySpec(c))
  );
  if (!hasMergedDataRow) return -1;
  for (let j = 1; j < ncol; j++) {
    if (j === resultCol || j === specCol) continue; // (2)
    const vals: string[] = [];
    for (const row of dataRows) {
      const c = nrm(row[j] ?? "");
      if (!c) continue;
      if (classifySpec(c) || isBare(c) || isMethod(c) || isUnitCell(c) || isMesh(c)) continue; // (3)
      if (c.length > 20) continue; // ป้ายแยกแถวสั้นเสมอ — ข้อความยาว = หมายเหตุ
      vals.push(c);
    }
    if (vals.length < 2 || vals.length < dataRows.length / 2) continue; // (4)
    if (new Set(vals).size < 2) continue; // (5)
    return j;
  }
  return -1;
}

// ทิศของคอลัมน์ spec — "upper" (le/lt ส่วนใหญ่), "lower" (ge/gt ส่วนใหญ่), "mixed" (ไม่ชัด)
// ใช้แยก bare-0 ใน spec col → specMax หรือ specMin อย่างน้อย 1 hit ต่างฝ่ายก็ mixed → abstain
function specColDirection(dataRows: string[][], specCol: number): "upper" | "lower" | "mixed" {
  let upper = 0;
  let lower = 0;
  for (const row of dataRows) {
    const s = classifySpec(row[specCol] ?? "");
    if (!s) continue;
    if (s.specMax != null || (s.specRaw && /^(?:≤|≦|<=|<|\d.*max)/i.test(nrm(s.specRaw)))) upper++;
    else if (s.specMin != null || (s.specRaw && /^(?:≥|≧|>=|>|\d.*min)/i.test(nrm(s.specRaw)))) lower++;
    // range (specRaw only) ไม่นับทิศ — ไม่ช่วยตัดสิน
  }
  if (upper === 0 && lower === 0) return "mixed";
  if (lower === 0) return "upper";
  if (upper === 0) return "lower";
  return "mixed";
}

// คอลัมน์ค่าผลที่หัวตารางตั้งชื่อด้วยเลขล็อต ("LOT NO. 850993 | LOT NO. 850997" — Suzorite 2 ล็อตในใบเดียว)
//   ≥2 คอลัมน์ = ต้องออกแถวให้ทุกล็อต ไม่ใช่หยิบคอลัมน์ขวาสุดแล้วแปะป้ายล็อตซ้าย (ค่ากับป้ายคนละล็อต)
function lotColumns(header: string[]): { idx: number; lot: string }[] {
  const out: { idx: number; lot: string }[] = [];
  for (let j = 0; j < header.length; j++) {
    const m = nrm(header[j]).match(/^lot\s*no\.?\s*([A-Za-z0-9\-]+)$/i);
    if (m) out.push({ idx: j, lot: m[1] });
  }
  return out;
}

// สร้าง items จาก grid โดยอ่านค่าผลจากคอลัมน์ที่กำหนด — เรียกซ้ำได้คอลัมน์ละล็อต (namePrefix = ป้ายล็อต)
function emitGridItems(
  dataRows: string[][],
  ncol: number,
  resultCol: number,
  source: "structural" | "scanned-vector",
  namePrefix: string,
  // คอลัมน์ค่าผลของล็อตอื่นในใบเดียวกัน — ห้ามให้ค่าของล็อตข้างๆ ("<0.010") กลายเป็นเกณฑ์ของแถวนี้
  otherValueCols: ReadonlySet<number> = new Set()
): RawCoaItem[] {
  // specCol + direction — ใช้กู้ bare-number ในคอลัมน์ spec ที่ classifySpec ข้ามไป (เช่น spec=0)
  const specCol = resolveSpecCol(dataRows, ncol, resultCol, otherValueCols);
  const specDir = specCol >= 0 ? specColDirection(dataRows, specCol) : "mixed";
  // ป้ายแยกแถวใต้ชื่อกลุ่ม merged (D50/D90/Fe2O3) — -1 ถ้าใบนี้ไม่ใช่ layout นั้น
  // ★ structural เท่านั้น ★ — scanned-vector สร้าง cell จาก token OCR ที่เลื่อนได้ ต่อป้ายแล้วชื่อมั่ว
  //   (PR1950W_4063 ได้ "Softening point 125℃ mm" ทั้งที่แถวนั้นคือ Flow) — เส้นตารางจริงเท่านั้นที่เชื่อ cell ได้
  const subLabelCol =
    source === "structural" ? resolveSubLabelCol(dataRows, ncol, resultCol, specCol) : -1;

  // ★ section carry เฉพาะ structural ★ — แถวที่ col0 ว่างยืมชื่อแถวบนได้ต่อเมื่อมาจากเส้นตารางจริง (merged group)
  //   scanned-vector ชื่อสั้นหลุดคอลัมน์ได้ (เคสจริง PR1950W_4063) — col0 ว่างอาจแปลว่า "ชื่อหาย" ไม่ใช่แถวลูกของกลุ่ม
  const carrySection = source === "structural";
  const items: RawCoaItem[] = [];
  let section = "";
  for (const row of dataRows) {
    const col0 = row[0] ?? "";
    if (col0 && !isMesh(col0)) section = col0;

    // locate per-row special cells (content-driven, excluding the locked result column)
    let meshIdx = -1;
    let methodIdx = -1;
    let unitIdx = -1;
    for (let j = 0; j < row.length; j++) {
      if (j === resultCol || otherValueCols.has(j)) continue;
      const c = row[j];
      if (!c) continue;
      if (meshIdx < 0 && isMesh(c)) meshIdx = j;
      else if (methodIdx < 0 && isMethod(c)) methodIdx = j;
      else if (unitIdx < 0 && isUnitCell(c)) unitIdx = j;
    }

    const base = col0 && !isMesh(col0) ? col0 : carrySection ? section : "";
    const mesh = meshIdx >= 0 ? row[meshIdx] : "";
    // ป้ายท้ายชื่อ: mesh (+100/-325) มาก่อนตามพฤติกรรมเดิม · ไม่มี mesh จึงใช้ sub-label ของ merged group
    const suffix = mesh || (subLabelCol >= 0 ? nrm(row[subLabelCol] ?? "") : "");
    const bare = suffix ? `${base} ${suffix}`.trim() : base;
    const name = namePrefix ? `${namePrefix} ${bare}`.trim() : bare;
    const method = methodIdx >= 0 ? row[methodIdx] : null;
    const unit = unitIdx >= 0 ? unitText(row[unitIdx]) : null;
    const resultRaw = resultCol >= 0 ? row[resultCol] ?? "" : "";

    // spec = first spec-pattern cell, excluding name(0)/mesh/method/unit/result columns
    let spec: SpecCells | null = null;
    for (let j = 0; j < row.length; j++) {
      if (j === 0 || j === resultCol || j === meshIdx || j === methodIdx || j === unitIdx) continue;
      if (otherValueCols.has(j)) continue; // ค่าผลของล็อตอื่น ไม่ใช่เกณฑ์ของแถวนี้
      const got = classifySpec(row[j]);
      if (got) {
        spec = got;
        break;
      }
    }

    // ★ กู้ bare-number ใน specCol เมื่อ classifySpec ข้ามไป (เลขเดี่ยวไม่มี operator) ★
    // เงื่อนไข: spec ว่าง + specCol ชัดเจน (≥1 hit) + specCol cell เป็น bare number + ทิศคอลัมน์ไม่ mixed
    // → route ตามทิศ upper→specMax, lower→specMin (geometry-based, ไม่ hardcode domain)
    if (!spec && specCol >= 0 && specDir !== "mixed") {
      const cell = nrm(row[specCol] ?? "");
      if (isBare(cell) && !isMesh(cell)) {
        const v = numOrNull(cell);
        if (v !== null) {
          spec = specDir === "upper" ? { specMax: v } : { specMin: v };
        }
      }
    }

    // ABSTAIN: a spacer row (no spec, no result) is dropped; a row with no identifiable name is not
    //   emitted (phantom). A row with only one of spec/result still emits → evaluator honest-SKIPs.
    if (!spec && !resultRaw) continue;
    if (!base && !mesh) continue;

    items.push({
      name,
      unit,
      method,
      specRaw: spec?.specRaw ?? null,
      specMin: spec?.specMin ?? null,
      specMax: spec?.specMax ?? null,
      result: resultRaw || null,
    });
  }
  return items;
}

// Parse a pdfplumber structural grid into RawCoa with NO LLM. orient is informational — grid is already items-as-rows.
// source: "structural" = เส้นตารางจริงเชื่อ cell ได้ · "scanned-vector" = OCR เลื่อนได้ → ปิดฟีเจอร์ที่พึ่งตำแหน่ง cell
export function parseStructuralGrid(
  gridText: string,
  _orient: GridOrient,
  source: "structural" | "scanned-vector" = "structural"
): RawCoa {
  const rows = splitGrid(gridText);
  if (rows.length === 0) return { product: null, lotNo: null, items: [] };
  const ncol = rows[0].length;

  const lotFrom = (rowCells: string[]): string | null => {
    for (const c of rowCells) {
      const m = c.match(/lot\s*no\.?\s*([A-Za-z0-9\-]+)/i);
      if (m) return m[1];
    }
    return null;
  };

  // ★ layout Lower/Upper-limit แยกคอลัมน์ (Z99, Barimite) ★ — เช็ค row 0 ตรงๆ ไม่ผ่าน isHeaderRow
  //   ที่ keyword แคบ · ต้องมี lower+upper+result คนละคอลัมน์ data จึงไม่ false-trigger
  if (rows.length > 1) {
    const aligned = alignHeaderToData(rows[0], rows.slice(1));
    const roles = detectSeparateLimitHeader(aligned);
    if (roles) return parseSeparateLimitGrid(rows.slice(1), roles, lotFrom(rows[0]));
  }

  let lotNo: string | null = null;
  let dataRows = rows;
  if (rows.length > 1 && isHeaderRow(rows[0])) {
    lotNo = lotFrom(rows[0]);
    dataRows = rows.slice(1);
  }

  // ใบที่มีหลายล็อตเป็นคอลัมน์ค่าผล → อ่านทุกคอลัมน์ แล้วติดป้ายล็อตไว้ในชื่อแถวให้คนแยกออก
  //   structural เท่านั้น (เส้นตารางจริง) — scanned-vector วาง cell จาก token OCR ที่เลื่อนได้ ค่าจะข้ามล็อต
  const lots = source === "structural" && dataRows !== rows ? lotColumns(rows[0]) : [];
  const lotCols = lots.filter(({ idx }) => dataRows.some((r) => nrm(r[idx] ?? "") !== ""));
  if (lotCols.length >= 2) {
    const lotIdx = new Set(lotCols.map((l) => l.idx));
    const items = lotCols.flatMap((l) =>
      emitGridItems(
        dataRows,
        ncol,
        l.idx,
        source,
        `LOT No.${l.lot}`,
        new Set([...lotIdx].filter((j) => j !== l.idx))
      )
    );
    // ไม่ประกาศเลขล็อตที่หัวรายงาน — ค่าในใบมาจากหลายล็อต ป้ายล็อตอยู่ในชื่อแถวของตัวเองแล้ว
    if (items.length > 0) return { product: null, lotNo: null, items };
  }

  const resultCol = resolveResultCol(dataRows, ncol);
  return { product: null, lotNo, items: emitGridItems(dataRows, ncol, resultCol, source, "") };
}
