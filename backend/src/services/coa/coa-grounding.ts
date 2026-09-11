// ★ Anti-hallucination guard ★ — ตัด row ที่ไม่มีอยู่จริงในเอกสารก่อน evaluate
//   (เคสจริง 1F1710: LLM ปั้นทั้งใบเป็น metal COA ที่ไม่มีในเอกสาร → PASS ปลอม 3 แถว, needsReview=false = มั่นใจผิด ๆ)
//   grounded ต้องมีชื่อ row ใน OCR หรือ result+spec co-locate บรรทัดเดียวกัน — ไม่เข้าทั้งสอง = ถือว่าปั้น → drop
import { RawCoaItem } from "./ollama-coa.service";
import { EvaluatedItem, textKey } from "./coa-evaluator";

export interface GroundingResult {
  kept: RawCoaItem[];
  dropped: { name: string; reason: string }[];
}

interface NumToken {
  val: number;
  digits: string;
}

// ★ CJK (ญี่ปุ่น/จีน) ★ — hiragana+katakana U+3040-30FF, kanji U+4E00-9FFF
//   ใบ 試験成績表 ญี่ปุ่นเขียนชื่อรายการเป็น CJK ล้วน (粒度, 嵩密度, 化学成分) — regex latin+ไทย เดิม
//   ตัดทิ้งหมด → ชื่อกลายเป็นค่าว่าง → grounding ตัดแถวที่ถูกต้องว่าเป็น hallucination (เคสจริง KGP-H65)
const CJK = "\\u3040-\\u30ff\\u4e00-\\u9fff";
const HAS_CJK = new RegExp(`[${CJK}]`);
// CJK เขียนติดกันไม่มีช่องว่าง → token 2 ตัวอักษรคือ "คำเต็ม" แล้ว (粒度 = particle size) และ dense พอ
//   ที่จะไม่ชนบังเอิญ (kanji 2 ตัว ≈ ล้านคู่) → ยอมรับ ≥2 เฉพาะ token ที่มี CJK
const MIN_TOKEN = 3;

// ช่องที่ขึ้นต้นด้วยตัวเลข = บรรทัดนี้ถือค่าของตัวเอง — ใช้แยก "แถวป้าย" ออกจาก "แถวที่ถือค่าเอง"
//   ต้องหลวมพอรับค่าที่มีหน่วยต่อท้าย ("0.35 g/L") ไม่งั้นแถวแนวตั้งปกติถูกนับเป็นแถวป้าย
const VALUE_CELL = /^[-+<>≤≥(\[]?\s*\d/;
const longEnough = (t: string) => t.length >= MIN_TOKEN || (t.length >= 2 && HAS_CJK.test(t));

// alpha token ของชื่อ — ตัดเลข/อักขระทิ้ง, lower-case (รับ latin + ไทย + CJK)
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(new RegExp(`[^a-z฀-๿${CJK}]+`, "g"), " ")
    .trim()
    .split(/\s+/)
    .filter(longEnough);
}

// เลขทุกตัวใน value (รับ string/number/{avg,min,max,raw}) → string token เลขดิบ
function numberTokens(v: unknown): string[] {
  if (v == null) return [];
  let s: string;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    s = [o.raw, o.avg, o.min, o.max].filter((x) => x != null).join(" ");
  } else {
    s = String(v);
  }
  return s.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
}

const digitsOnly = (s: string) => s.replace(/[^\d]/g, "");

function parseNumTokens(text: string): NumToken[] {
  // OCR แทรก space ในเลขทศนิยม ("1. 09" → 1.09, "0. 70" → 0.70) — รวมก่อน tokenize
  //   ไม่งั้น guard เห็น "1. 09" เป็น {1, 9} → คิดว่า result ไม่อยู่บรรทัด → downgrade PASS ที่ถูกต้องผิด ๆ
  //   (ZP10: result-recovery เติม 1.09 ถูกแล้ว แต่ pass-guard มองไม่เห็นบนบรรทัดเพราะ space artifact)
  const norm = text.replace(/(\d)\.\s+(\d)/g, "$1.$2");
  return (norm.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((t) => ({
    val: Number(t.replace(/,/g, ".")),
    digits: digitsOnly(t),
  }));
}

// item number token ตรงกับ OCR token ตัวใดตัวหนึ่งไหม — match ทั้ง token (ไม่ใช่ substring)
//   (1) ค่าตัวเลขเท่ากัน 160 == 160.000   (2) digit-string เท่ากัน 423 ↔ 42.3 (เผื่อ OCR ทศนิยมหาย)
function numberMatches(n: string, tokens: NumToken[]): boolean {
  const v = Number(n.replace(/,/g, "."));
  const d = digitsOnly(n);
  for (const o of tokens) {
    if (!Number.isNaN(v) && v === o.val) return true;
    if (d.length >= 2 && d === o.digits) return true;
  }
  return false;
}

// ★ transposed-table grounding (path 3) ★ — เอกสารที่ชื่อ/spec/result อยู่คนละบรรทัด (RI-015 chem)
//   grounded เมื่อ result+spec อยู่ column เดียวกัน ในบล็อก pipe ที่มีชื่อ row
//   ต้อง exact-value ไม่ใช่ align บังเอิญ กัน fabricated row หลุด

// block = บรรทัด pipe-delimited ติดกัน (≥3 cell/บรรทัด, ≥2 บรรทัด/block) — เก็บ raw line ไว้ match ชื่อ
function buildPipeBlocks(ocrText: string): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of ocrText.split(/\r?\n/)) {
    if (line.includes("|") && line.split("|").length >= 3) block.push(line);
    else {
      if (block.length >= 2) blocks.push(block);
      block = [];
    }
  }
  if (block.length >= 2) blocks.push(block);
  return blocks;
}

// token ตัวอักษร ≥2 ของชื่อ (รับ symbol ธาตุ Cu/Zn + CJK) — ใช้ผูกชื่อกับ block
function nameSignal(name: string): string[] {
  return (name ?? "")
    .toLowerCase()
    .replace(new RegExp(`[^a-z0-9${CJK}]+`, "g"), " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

// ★ exact-value cell match (ไม่ใช้ digit-string ↔ ฝั่ง keep หลวม = keep ปลอม, ดู valuePresent) ★
function cellHasValue(n: string, cell: NumToken[]): boolean {
  const v = Number(n.replace(/,/g, "."));
  if (Number.isNaN(v)) return false;
  return cell.some((o) => Math.abs(o.val - v) < 1e-9);
}

function isTransposedGrounded(
  name: string,
  resultNums: string[],
  specNums: string[],
  blocks: string[][]
): boolean {
  const sig = nameSignal(name);
  if (!sig.length) return false; // ไม่มี name signal → ไม่ ground (กัน fabricated)
  for (const block of blocks) {
    // ★ name precondition ★ — ชื่อ row ต้องโผล่ใน block นี้ (กัน row ที่ LLM ตั้งชื่อมั่ว)
    const blockNorm = block
      .join(" ")
      .toLowerCase()
      .replace(new RegExp(`[^a-z0-9${CJK}]+`, "g"), "");
    if (!sig.some((t) => blockNorm.includes(t))) continue;
    const cells = block.map((l) => l.split("|").map((c) => parseNumTokens(c)));
    const maxCols = Math.max(...cells.map((c) => c.length));
    for (let k = 1; k < maxCols; k++) {
      let rLine = -1;
      let sLine = -1;
      for (let li = 0; li < cells.length; li++) {
        const cell = cells[li][k];
        if (!cell || !cell.length) continue;
        if (rLine < 0 && resultNums.some((n) => cellHasValue(n, cell))) rLine = li;
        if (sLine < 0 && specNums.some((n) => cellHasValue(n, cell))) sLine = li;
      }
      if (rLine >= 0 && sLine >= 0 && rLine !== sLine) return true;
    }
  }
  return false;
}

// 1 row grounded ไหม
function isGrounded(
  item: RawCoaItem,
  ocrWords: Set<string>,
  ocrNoSpace: string,
  lineTokens: NumToken[][],
  pipeBlocks: string[][],
  lineNorms: string[]
): boolean {
  // 1. name grounding — whole-word (latin) หรือ substring เฉพาะ token ยาว ≥5 (เผื่อไทย/ชื่อยาว)
  //    ไม่ substring token สั้น (3-4) กัน "tin" ไปแมตช์ "testing", "iron" แมตช์ "environment"
  //    CJK: ยอม substring ที่ ≥2 — ocrWords เป็น latin-only และคำ CJK ไม่มีช่องว่างให้ตัดเป็น word
  for (const t of nameTokens(item.name ?? "")) {
    if (ocrWords.has(t)) return true;
    if (t.length >= 5 && ocrNoSpace.includes(t)) return true;
    if (t.length >= 2 && HAS_CJK.test(t) && ocrNoSpace.includes(t)) return true;
  }
  // 2. number co-location — result และ spec ต้องอยู่ "บรรทัดเดียวกัน"
  const resultNums = numberTokens(item.result);
  const specNums = [
    ...numberTokens(item.specRaw),
    ...numberTokens(item.specMin),
    ...numberTokens(item.specMax),
  ];
  // ★ LLM ไม่คืน result (drift ที่เห็นจริงกับ CIIR1066 หน้า 1) ★ — เกณฑ์ยังอยู่ใน OCR ครบ
  //   keep ไว้ให้ recovery เติม result ทีหลัง: ต้องเจอเกณฑ์ครบทุกค่าในบรรทัดเดียวที่มีชื่อรายการนำหน้า
  if (!resultNums.length && specNums.length >= 2) {
    const sig = nameSignal(item.name ?? "");
    for (let i = 0; i < lineTokens.length; i++) {
      if (!lineTokens[i]?.length) continue;
      if (!specNums.every((n) => numberMatches(n, lineTokens[i]))) continue;
      const norm = lineNorms[i] ?? "";
      if (sig.length && sig.some((t) => norm.includes(t))) return true;
    }
  }
  // ★ ใบไม่ได้เขียนเกณฑ์ของแถวนี้ (ช่องเกณฑ์ว่างจริง — PAG-80 ที่ช่องเกณฑ์คร่อม 2 แถว) ★
  //   ไม่มีเกณฑ์ให้ทานคู่ จึงบังคับให้เห็นชื่อแถว "ครบทุกคำ" อยู่บรรทัดเดียวกับค่าผล
  if (resultNums.length && !specNums.length) {
    const sig = nameSignal(item.name ?? "");
    for (let i = 0; sig.length && i < lineTokens.length; i++) {
      if (!lineTokens[i]?.length) continue;
      if (!resultNums.some((n) => numberMatches(n, lineTokens[i]))) continue;
      const norm = lineNorms[i] ?? "";
      if (sig.every((t) => norm.includes(t))) return true;
    }
  }
  if (!resultNums.length || !specNums.length) return false;
  for (const lt of lineTokens) {
    if (!lt.length) continue;
    const rHit = resultNums.some((n) => numberMatches(n, lt));
    const sHit = specNums.some((n) => numberMatches(n, lt));
    if (rHit && sHit) return true;
  }
  // 3. transposed-table — result กับ spec column เดียวกัน คนละบรรทัด ใน pipe-block + ชื่ออยู่ใน block
  if (isTransposedGrounded(item.name ?? "", resultNums, specNums, pipeBlocks)) return true;
  return false;
}

// ตัด row ที่ไม่มี grounding ใน OCR (น่าจะ LLM ปั้น) — คืนชุดใหม่ (ไม่ mutate)
export function dropUngroundedItems(
  items: RawCoaItem[],
  ocrText: string
): GroundingResult {
  if (!items?.length || !ocrText) return { kept: items ?? [], dropped: [] };

  // ชุดคำ latin จาก OCR (match ชื่อแบบทั้งคำ)
  const ocrWords = new Set(
    ocrText.toLowerCase().match(/[a-z]{3,}/g) ?? []
  );
  const ocrNoSpace = ocrText.toLowerCase().replace(/\s+/g, "");
  // number token ต่อบรรทัด (co-location) + รูป normalize ของบรรทัดเดียวกัน (ใช้เช็คว่ามีชื่อรายการนำหน้า)
  const lines = ocrText.split(/\r?\n/);
  const lineTokens = lines.map(parseNumTokens);
  const lineNorms = lines.map((l) =>
    l.toLowerCase().replace(new RegExp(`[^a-z0-9${CJK}]+`, "g"), "")
  );
  // pipe-block สำหรับ transposed grounding (path 3)
  const pipeBlocks = buildPipeBlocks(ocrText);

  const kept: RawCoaItem[] = [];
  const dropped: { name: string; reason: string }[] = [];
  for (const it of items) {
    if (isGrounded(it, ocrWords, ocrNoSpace, lineTokens, pipeBlocks, lineNorms)) {
      kept.push(it);
    } else {
      dropped.push({
        name: (it.name ?? "(unknown)").trim(),
        reason: "ไม่พบชื่อ/ค่าใน OCR บรรทัดเดียวกัน — น่าจะ LLM ปั้น (hallucination)",
      });
    }
  }
  return { kept, dropped };
}

// ★ OCR digit-scramble outlier guard ★ — ปักธง FAIL ที่ result ห่างจาก specMax เกิน 100× ว่าเลขน่าจะเพี้ยน
//   เคสจริง 1F1710: OCR อ่าน "1.090" เป็น "0601" หลุด spec ทั้งที่ tokens co-locate ปกติ (fail-guard ไม่จับ)
//   เฉพาะ two-sided spec (one-sided วัดไม่ได้ว่าไกลแค่ไหน) — คง FAIL ไว้เสมอ (user decision 2026-09-11) แค่เติมธงเตือน
export function downgradeOcrOutlierFails(rows: EvaluatedItem[]): FailGuardResult {
  const downgraded: { name: string; reason: string }[] = [];
  for (const r of rows) {
    if (r.status !== "FAIL") continue;
    if (r.min == null || r.max == null || r.max <= 0) continue;
    const result = typeof r.result === "number" ? r.result : Number(r.result);
    if (!Number.isFinite(result)) continue;
    if (result > r.max * 100) {
      const reason =
        "ค่าผลห่างเกณฑ์มากผิดปกติ — น่าจะ OCR อ่านตัวเลขผิด (digit scramble) เทียบกับใบจริง";
      r.needsReview = true;
      r.reason = r.reason?.trim() ? `${r.reason} · ${reason}` : reason;
      downgraded.push({ name: r.name, reason });
    }
  }
  return { downgraded };
}

// ★ Anti-fabricated-FAIL guard (column collapse) ★ — ปักธง FAIL ที่ spec อาจไม่ใช่ของแถวตัวเอง (broadcast bug)
//   เคสจริง Lot240521: scan เอียง → LLM ยัด spec ค่าเดียวทุกแถว → FAIL ปลอมที่ไม่ปักธง
//   spec+result co-locate บรรทัดเดียวกันจึงคง verdict ตรงๆ · ไม่ co-locate → คง FAIL แต่ปักธงให้เทียบใบจริง
export interface FailGuardResult {
  downgraded: { name: string; reason: string }[];
}

// ★ คำว่า "สลับ" ใน reason นี้ load-bearing — coa-pipeline COLLAPSE_SKIP_RE ใช้ trigger grid challenger ★
export const FAIL_COLLAPSE_REASON =
  "เกณฑ์กับค่าผลอยู่คนละจุดในเอกสาร ระบบอาจอ่านสลับแถว — เทียบกับใบจริง";

// mutate rows in place: FAIL ที่ spec+result ไม่ co-locate → คง FAIL + ปักธง. คืนรายการที่ปักธง
export function downgradeUngroundedFails(
  rows: EvaluatedItem[],
  ocrText: string
): FailGuardResult {
  const downgraded: { name: string; reason: string }[] = [];
  if (!rows?.length || !ocrText) return { downgraded };

  const lineTokens = ocrText.split(/\r?\n/).map(parseNumTokens);

  for (const r of rows) {
    if (r.status !== "FAIL") continue;

    // เลขของ result (จาก resultRaw + ค่าที่ normalize แล้ว) และ spec (specRaw + min/max)
    const resultNums = [
      ...numberTokens(r.resultRaw),
      ...(r.result != null ? [String(r.result)] : []),
    ];
    const specNums = [
      ...numberTokens(r.specRaw),
      ...(r.min != null ? [String(r.min)] : []),
      ...(r.max != null ? [String(r.max)] : []),
    ];
    // ไม่มีเลขให้เทียบฝั่งใดฝั่งหนึ่ง → พิสูจน์ไม่ได้ว่า collapse → ปล่อยตามเดิม (อย่าตัดสินมั่ว)
    if (!resultNums.length || !specNums.length) continue;

    let colocated = false;
    for (const lt of lineTokens) {
      if (!lt.length) continue;
      const rHit = resultNums.some((n) => numberMatches(n, lt));
      // ★ ต้องครบทุก bound ★ — spec ทั้งหมด (min+max) ต้องอยู่บรรทัด result เดียวกัน ใช้ .every ไม่ใช่ .some
      //   กัน "range ประกอบข้ามแถว": LLM เล็ก comma-join cell คนละคอลัมน์ (เคสจริง Lot240521 350μ ยืม 56 จากแถว 150μ)
      //   .some เดิมปล่อยผ่านเพราะ bound บางตัวบังเอิญอยู่บรรทัดเดียวกัน ทำให้ fabricated FAIL รอด
      const sHit = specNums.every((n) => numberMatches(n, lt));
      if (rHit && sHit) {
        colocated = true;
        break;
      }
    }
    if (colocated) continue;

    r.needsReview = true;
    r.reason = r.reason?.trim()
      ? `${r.reason} · ${FAIL_COLLAPSE_REASON}`
      : FAIL_COLLAPSE_REASON;
    downgraded.push({ name: r.name, reason: FAIL_COLLAPSE_REASON });
  }
  return { downgraded };
}

// ★ Anti-deceptive-PASS guard (column collapse, PASS side) ★ — คู่แฝดของ downgradeUngroundedFails แต่ฝั่ง PASS
//   false-PASS คือบาปหนักสุดของ QA (เคสจริง Lot240521: LLM ยกผล/spec ข้ามแถวมา ได้ 42≤45 PASS ทั้งที่ตัวจริงคือ 0.3≤3)
//   ต้อง anchor ด้วยชื่อแถว (ไม่ใช่ any-line) — พิสูจน์ collapse ไม่ได้ = คง PASS (honest miss ดีกว่า false SKIP)
export interface PassGuardResult {
  downgraded: { name: string; reason: string }[];
}

// (ห้ามใส่คำ "สลับ"/"ทิศหาย" — ไม่งั้นจะ trigger grid challenger โดยไม่ตั้งใจ ดู coa-pipeline COLLAPSE_SKIP_RE)
export const PASS_DOWNGRADE_REASON =
  "ค่าผลอาจมาจากแถวอื่น (ไม่ตรงกับชื่อรายการในเอกสาร) — เทียบกับใบจริง";

// token ของชื่อสำหรับ anchor — เก็บเลขไว้ (500/350/150 คือตัวแยกแถว sieve), lower-case latin+digit+CJK
function anchorTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(new RegExp(`[^a-z0-9${CJK}]+`, "g"), " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /\d/.test(t));
}

// digit-string ของ "เลขที่ฝังในชื่อ" (500/106/350) — กันบรรทัดชื่อ/header ที่มีแต่เลขในชื่อ ไม่ให้นับเป็น data line
function nameEmbeddedDigits(name: string): Set<string> {
  return new Set((name.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map(digitsOnly));
}

// ★ exact-value match (ฝั่ง keep) ★ — ไม่ใช้ digit-string match แบบ numberMatches ("42.3"=="423")
//   เพราะฝั่ง keep ความ "หลวม" = keep PASS ปลอม (เลขที่ยืมมาบังเอิญ digit ตรงเลข decimal-shift ในบรรทัด)
//   decimal-loss เป็นความเสี่ยง FAIL ปลอม (detectDecimalRisk จับแยกแล้ว) ไม่ใช่เหตุให้ keep PASS
function valuePresent(v: number, tokens: NumToken[]): boolean {
  return tokens.some((o) => Math.abs(o.val - v) < 1e-9);
}

// mutate rows in place: PASS ที่ result ไม่อยู่ "บรรทัด data ของชื่อตัวเอง" → SKIP. คืนรายการที่ downgrade
export function downgradeUngroundedPasses(
  rows: EvaluatedItem[],
  ocrText: string
): PassGuardResult {
  const downgraded: { name: string; reason: string }[] = [];
  if (!rows?.length || !ocrText) return { downgraded };

  const lines = ocrText.split(/\r?\n/);
  const lineSigs = lines.map((l) => new Set(anchorTokens(l)));
  const lineNums = lines.map(parseNumTokens);
  // cells ของแต่ละบรรทัด normalize เป็น alnum ล้วน — ใช้ glue-match (ชื่อแถวติดกันเป็น cell เดียว)
  const cellNorm = new RegExp(`[^a-z0-9${CJK}]+`, "g");
  const splitCells = (l: string) => (l.includes("|") ? l.split("|") : l.split(/\s{2,}/));
  const lineCells = lines.map((l) =>
    splitCells(l).map((c) => c.toLowerCase().replace(cellNorm, ""))
  );
  // label = token ของ "cell แรก" (ช่องชื่อรายการ) — ใช้ตัดขอบ sub-row scan ให้ไม่ข้ามไปแถวอื่น
  const lineLabels = lines.map((l) => anchorTokens(splitCells(l)[0] ?? ""));

  for (const r of rows) {
    if (r.status !== "PASS") continue;

    const nameSig = anchorTokens(r.name);
    if (nameSig.length < 2) continue; // ชื่อสั้น/glued → anchor ไม่ชัด → ปล่อย (conservative)

    // หาบรรทัด overlap สูงสุด (= บรรทัดของ row นี้). threshold เดียวกับ spec-recovery
    const need = Math.max(2, Math.ceil(nameSig.length * 0.6));
    // ★ glue-tolerant anchor ★ — OCR บางทีอ่านชื่อแถวติดกันเป็น token เดียว ทำ token-match พลาดไปแมตช์บรรทัดอื่น
    //   ที่แชร์ token บางส่วน → downgrade PASS ที่ถูกต้องทิ้ง (เคสจริง Lot240521 350μ)
    //   กันด้วย exact-cell match (ไม่ใช่ substring) — ต้องตรงทั้ง cell ถึงได้ full credit ไม่งั้น fall back เดิม
    const joinedName = nameSig.join("");
    // ★ aperture exclusion (Lot240521 150μ) ★ — เลขฝังในชื่อ (150/350/500) คือตัวแยกแถว unique
    //   บรรทัดที่ไม่มีเลขนี้ = ไม่ใช่แถวนี้ → score 0 กัน garble ชื่อข้าม aperture ผิด (false SKIP)
    //   เปิดเฉพาะเมื่อมี ≥1 บรรทัดมี aperture จริง — garble หายหมดทุกบรรทัด → fall back scoring เดิม
    const nameNums = nameEmbeddedDigits(r.name);
    const apertureOnSomeLine =
      nameNums.size > 0 &&
      lineNums.some((lt) => lt.some((tk) => nameNums.has(tk.digits)));
    const scores = lineSigs.map((ls, i) => {
      if (apertureOnSomeLine && !lineNums[i].some((tk) => nameNums.has(tk.digits)))
        return 0;
      const tok = nameSig.filter((t) => ls.has(t)).length;
      const glue =
        joinedName.length >= 6 && lineCells[i].some((c) => c === joinedName)
          ? nameSig.length
          : 0;
      return tok > glue ? tok : glue;
    });
    const bestScore = scores.reduce((a, b) => (b > a ? b : a), 0);
    if (bestScore < need) continue; // หาบรรทัดของ row นี้ไม่เจอ → พิสูจน์ collapse ไม่ได้ → ปล่อย

    const resultNums = [
      ...numberTokens(r.resultRaw).map((s) => Number(s.replace(/,/g, "."))),
      ...(r.result != null ? [r.result] : []),
    ].filter((n) => !Number.isNaN(n));
    if (!resultNums.length) continue; // ไม่มีเลข result ให้เทียบ → ปล่อย

    // ★ spec co-location เฉพาะ single-bound (Max/Min/≤/≥/=) ที่ bound โผล่ตรงตัวใน OCR ★ — ข้าม between/± (min≠max)
    //   เพราะ bound พวกนั้นเป็นค่าคำนวณ (7±3 → min4 max10) ไม่มีใน OCR เช็คจะ false-SKIP
    //   กัน borrowed-spec PASS: LLM ยืม bound หลวมจากแถวอื่น (12≤50 แทน 12≤10) → bound ไม่อยู่บรรทัดนี้จับได้
    const isBetween = r.min != null && r.max != null && r.min !== r.max;
    const boundVal = isBetween ? null : r.max != null ? r.max : r.min;

    let validated = false; // เจอบรรทัด data ที่ result (+bound) ตรงกันจริง
    let hasDataNumber = false; // บรรทัด anchor มีเลข "นอกเหนือเลขในชื่อ" ไหม (= เป็น data line จริง)
    for (let i = 0; i < lines.length; i++) {
      if (scores[i] !== bestScore) continue; // เฉพาะบรรทัด anchor (overlap สูงสุด, รวม ties)
      const lt = lineNums[i];
      if (!lt.length) continue;
      for (const tk of lt) if (!nameNums.has(tk.digits)) hasDataNumber = true;
      const rHit = resultNums.some((v) => valuePresent(v, lt));
      const sHit = boundVal == null || valuePresent(boundVal, lt); // between → ข้าม spec check
      if (rHit && sHit) {
        validated = true;
        break;
      }
    }

    if (validated) continue; // result(+bound) อยู่บรรทัด data จริง → ค่าเป็นของแถวนี้ → คง PASS
    if (!hasDataNumber) continue; // บรรทัดชื่อไม่มี data number (ชื่อ wrap/header) → พิสูจน์ collapse ไม่ได้ → คง PASS

    // เช็ค sub-row: ชื่อเป็น header ไร้ค่าตัวเอง (เช่น D-2072 "Shear Strength") ค่าจริงอยู่ sub-row ข้างล่าง
    //   ต้องมีขอบเขตชัด ไม่งั้น scan ไปเจอเลขที่ยืมมาจากแถวอื่น = guard ตายทั้งตัว
    //   ด่าน 1: anchor ต้องไม่มีเลขของตัวเองนอกช่องแรก · ด่าน 2: sub-row ต้องเป็น continuation เจอ item อื่นหยุดทันที
    const isHeaderLine = (li: number) => {
      const cells = splitCells(lines[li]);
      const hasOwn = (toks: NumToken[]) => toks.some((tk) => !nameNums.has(tk.digits));
      // ไม่มี delimiter ชัด → แยก cell ไม่ได้ → ถือว่าเป็นบรรทัด data ถ้ามีเลขของตัวเอง (conservative)
      if (cells.length <= 1) return !hasOwn(lineNums[li]);
      return !cells.slice(1).some((c) => hasOwn(parseNumTokens(c)));
    };
    if (!validated) {
      outerSubrow: for (let i = 0; i < lines.length; i++) {
        if (scores[i] !== bestScore) continue;
        if (!isHeaderLine(i)) continue; // บรรทัดมีค่าของตัวเอง → ไม่ใช่ header → ห้ามยืมค่าบรรทัดอื่น
        for (let li = i + 1; li < Math.min(i + 8, lines.length); li++) {
          if (/^\d+\s*[|]/.test(lines[li])) break; // เจอ item ลำดับถัดไป → หยุด
          const label = lineLabels[li].filter((t) => /[a-z]/.test(t) || HAS_CJK.test(t));
          const bullet = /^\s*[-–—•*]/.test(lines[li]); // sub-row marker
          if (!bullet && label.length && !label.some((t) => nameSig.includes(t))) break;
          const subLt = lineNums[li];
          const rHit = resultNums.some((v) => valuePresent(v, subLt));
          const sHit = boundVal == null || valuePresent(boundVal, subLt);
          if (rHit && sHit) { validated = true; break outerSubrow; }
        }
      }
      if (validated) continue;
    }

    // ★ ตารางแนวนอน: ชื่อรายการเป็นป้ายคอลัมน์ ค่าอยู่คนละบรรทัด ★ — โมเดล "ค่าต้องอยู่บรรทัดชื่อ"
    //   ของด่านนี้ใช้กับทรงนี้ไม่ได้เลย บรรทัดป้ายไม่เคยถือค่าของแถวไหน → ตัดสินไม่ได้ ต้องปล่อยตามสัญญาเดิม
    //   ของด่าน ("พิสูจน์ collapse ไม่ได้ → คง PASS") ไม่ใช่ downgrade เพราะบังเอิญมีเลขหลงบนแถวป้าย
    const labelCellCount = (li: number) =>
      splitCells(lines[li]).map((c) => c.trim()).filter((c) => c).length;
    const isLabelRowOwningName = (li: number) => {
      const cs = splitCells(lines[li]).map((c) => c.trim()).filter((c) => c);
      if (cs.length < 3) return false; // ป้ายน้อยกว่า 3 ช่อง = ไม่ใช่ตารางแนวนอน
      if (cs.some((c) => VALUE_CELL.test(c))) return false; // มีช่องที่ขึ้นต้นด้วยเลข = บรรทัดนี้ถือค่าเอง
      return lineCells[li].some((c) => c === joinedName); // ชื่อแถวนี้เป็นป้ายเต็มช่อง
    };
    // ทั้งค่าผลและขอบเกณฑ์ต้องโผล่ในบรรทัดตารางใต้แถวป้าย — ขาดอย่างใดอย่างหนึ่ง = ยกเลขมาจากที่อื่น
    //   (เงื่อนไขเดียวกับ path ตรวจบรรทัดเดียวข้างบน ต่างแค่ยอมให้ค่ากับเกณฑ์อยู่คนละบรรทัดตามทรงแนวนอน)
    const valueBelowLabelRow = (li: number) => {
      let rSeen = false;
      let bSeen = boundVal == null;
      for (let j = li + 1; j < Math.min(li + 4, lines.length); j++) {
        if (labelCellCount(j) < 3) continue; // บรรทัดที่ไม่ใช่ตาราง (หัวจดหมาย/หมายเหตุ) ไม่นับ
        if (resultNums.some((v) => valuePresent(v, lineNums[j]))) rSeen = true;
        if (boundVal != null && valuePresent(boundVal, lineNums[j])) bSeen = true;
      }
      return rSeen && bSeen;
    };
    let transposed = false;
    for (let i = 0; i < lines.length && !transposed; i++) {
      if (scores[i] !== bestScore) continue;
      if (isLabelRowOwningName(i) && valueBelowLabelRow(i)) transposed = true;
    }
    if (transposed) continue;

    // บรรทัดชื่อมี data number ของตัวเอง แต่ result/bound ที่ LLM ให้ไม่ตรง → ยกเลขมาจากแถวอื่น (deceptive)
    r.status = "SKIP";
    r.needsReview = true;
    r.reason = PASS_DOWNGRADE_REASON;
    downgraded.push({ name: r.name, reason: PASS_DOWNGRADE_REASON });
  }
  return { downgraded };
}

// แถวข้อความที่ผ่านเพราะ "เกณฑ์ตรงกับผล" ต้องเห็นข้อความนั้นในใบ 2 ครั้ง (ช่องเกณฑ์ + ช่องผล)
//   โผล่ครั้งเดียว = LLM คัดค่าผลมาใส่ช่องเกณฑ์เอง (Kemolit "Foreign Particles" เกณฑ์จริงคือ VISUAL)
export function downgradeCopiedTextPasses(
  rows: EvaluatedItem[],
  ocrText: string
): PassGuardResult {
  const downgraded: { name: string; reason: string }[] = [];
  if (!rows?.length || !ocrText) return { downgraded };

  const paper = textKey(ocrText);
  for (const r of rows) {
    if (r.status !== "PASS" || r.result != null) continue;
    const key = textKey(r.specRaw);
    if (!key || key !== textKey(r.resultRaw)) continue;

    let seen = 0;
    for (let i = paper.indexOf(key); i >= 0; i = paper.indexOf(key, i + key.length)) seen++;
    if (seen >= 2) continue; // ใบเขียนไว้ทั้งสองช่องจริง → ผ่านตามใบ

    const why = `ใบมีข้อความ "${r.resultRaw}" ที่เดียว — ช่องเกณฑ์ของแถวนี้เขียนไว้อย่างอื่น ต้องอ่านจากใบเอง`;
    r.status = "SKIP";
    r.needsReview = true;
    r.reason = why;
    downgraded.push({ name: r.name, reason: why });
  }
  return { downgraded };
}
