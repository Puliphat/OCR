// ★ Anti-deceptive guard: result ถูก map เป็น "คอลัมน์ป้าย" (transposed/rotated table) → SKIP ★
//
// อาการ (เคสจริง RI-015 sieve table): แต่ละแถว OCR = "aperture | spec | result" เช่น
//   `0.425 | 10.0 - 45.0 | 36.0`. LLM หยิบ cell แรก (aperture 0.425 = ป้ายแถว) มาเป็น result
//   ทิ้ง 36.0 จริง → 0.425 vs 10-45 = FAIL ปลอม. fail-guard เดิมไม่จับ (0.425+10+45 อยู่บรรทัดเดียว).
//
// ★ ทำไม downgrade ไม่ overwrite ★ — ลอง overwrite (เอาเลขหลัง spec มาเป็น result) แล้ว review เจอว่า
//   ไม่ปลอดภัย: layout `result | spec | ค่าเพื่อนบ้าน/lot อื่น/เลข method` ก็เข้าเงื่อนไขเดียวกัน →
//   จะเขียนทับ result ที่ถูกด้วยเลขผิด = deceptive PASS (บาปหนักสุด). เพราะบนบรรทัดเดียว
//   "cell[0] เป็นป้าย" กับ "cell[0] เป็น result จริงที่อยู่ซ้าย spec" แยกไม่ออก →
//   action ที่ปลอดภัยคือ "ยอมรับว่า column mapping กำกวม → SKIP + needsReview" (honest > confident wrong).
//   (auto →PASS เฉพาะ pattern ที่ grade แล้ว = ต้องให้ user เปิด opt-in / ใช้ structural extractor)
//
// ★ SAFETY ★ fire เฉพาะ layout "ป้ายเป็นตัวเลขนำหน้า spec" — layout ปกติ `name|spec|result`
//   ไม่ fire (cell[0] เป็นชื่อ/ข้อความ ≠ result). แตะเฉพาะ PASS/FAIL → SKIP (สร้าง verdict ใหม่ไม่ได้).
import { EvaluatedItem } from "./coa-evaluator";

export interface ColumnShiftResult {
  downgraded: { name: string; result: string; suspectAfterSpec: string }[];
}

export const COLUMN_SHIFT_REASON =
  "result ตรงกับคอลัมน์ป้าย (ซ้ายของ spec) ใน OCR — column mapping กำกวม (อาจยกเลขผิดคอลัมน์) ตรวจใบจริง";

function toNum(s: string): number {
  let c = s.trim();
  if (c.includes(",") && !c.includes(".")) c = c.replace(/,/g, ".");
  else c = c.replace(/,/g, "");
  return Number(c);
}

// แยก cell: "|" ก่อน (reconstructText join), ไม่มีก็ ≥2 space
export function splitCells(line: string): string[] {
  const parts = line.includes("|") ? line.split("|") : line.split(/\s{2,}/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// cell เป็นตัวเลขเดี่ยวล้วนไหม (ตัด space ใน "1. 09" → 1.09) — range/text → null
export function singleNumberCell(cell: string): number | null {
  const t = cell.replace(/\s+/g, "");
  if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) return null;
  const n = toNum(t);
  return Number.isNaN(n) ? null : n;
}

// เลขทุกตัวใน cell (รับ range "10.0 - 45.0" → [10,45]) — แยก range/± ด้วย separator ชัดเจน
//   ★ ไม่ปล่อยให้ "-" ใน range ถูกกินเป็นเครื่องหมายลบ ★ (10.0-45.0 → [10,45] ไม่ใช่ [10,-45])
export function cellNumbers(cell: string): number[] {
  const norm = cell
    .replace(/(\d)\.\s+(\d)/g, "$1.$2")
    .replace(/[~–—〜～∼±]/g, " ")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 $2"); // hyphen ระหว่างเลข = ตัวคั่น range ไม่ใช่ลบ
  return (norm.match(/-?\d+(?:[.,]\d+)?/g) ?? [])
    .map((t) => toNum(t))
    .filter((n) => !Number.isNaN(n));
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const normTxt = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function specNumbersOf(r: EvaluatedItem): number[] {
  const nums: number[] = [];
  if (r.specRaw) nums.push(...cellNumbers(r.specRaw));
  if (r.min != null) nums.push(r.min);
  if (r.max != null) nums.push(r.max);
  return nums;
}

// ★ core detection (status-agnostic, ไม่ mutate) ★ — row นี้ result = คอลัมน์ป้าย (ซ้ายของ spec) ไหม:
//   ถ้าเข้าโครง `aperture(=result ปัจจุบัน) | spec | result-จริง` บนบรรทัด OCR เดียว → คืนเลข "result จริง
//   หลัง spec" (suspect); ไม่เข้าโครง → null. ใช้ทั้ง downgrade (ฝั่งนี้) และ sieve-recovery (overwrite→PASS).
export function findColumnShiftSuspect(
  r: EvaluatedItem,
  lines: string[]
): number | null {
  const resRaw = (r.resultRaw ?? (r.result == null ? "" : String(r.result))).trim();
  if (!resRaw) return null;

  const specNums = specNumbersOf(r);
  if (!specNums.length) return null;

  const resVal = singleNumberCell(resRaw); // null ถ้า result เป็น bound-text ("<0.150")
  const resNorm = normTxt(resRaw);

  for (const line of lines) {
    const cells = splitCells(line);
    if (cells.length < 3) continue; // ต้องมี ป้าย|spec|result อย่างน้อย

    // (1) cell[0] = result ปัจจุบัน (คอลัมน์ป้ายซ้ายสุด)
    const c0 = cells[0];
    const c0num = singleNumberCell(c0);
    const c0match =
      (resVal != null && c0num != null && near(c0num, resVal)) ||
      normTxt(c0) === resNorm;
    if (!c0match) continue;

    // (2) spec cell ถัดไป (index ≥1) ที่มีเลข spec ครบ
    let specIdx = -1;
    for (let i = 1; i < cells.length; i++) {
      const cn = cellNumbers(cells[i]);
      if (specNums.every((s) => cn.some((x) => near(x, s)))) {
        specIdx = i;
        break;
      }
    }
    if (specIdx < 1) continue;

    // (3) หลัง spec มี cell ตัวเลขเดี่ยว = "result จริงน่าจะอยู่ตรงนี้"
    //   ★ จอง "result ปัจจุบัน (aperture/ป้าย)" เท่านั้น — ไม่จอง spec bounds ★
    //   เพราะ result จริงในตาราง sieve มักเท่าขอบ spec (เช่น 0.0% retained ใน spec 0.0-1.0):
    //   `0.850 | 0.0 - 1.0 | 0.0` → result จริง 0.0 = spec.min พอดี. ถ้าจอง specNums จะเห็น 0.0
    //   เป็น "spec spillover" แล้วไม่ fire → ปล่อย aperture 0.85 (∈0-1) เป็น PASS ปลอม.
    const claimed = resVal != null ? [resVal] : [];
    for (let i = specIdx + 1; i < cells.length; i++) {
      const n = singleNumberCell(cells[i]);
      if (n == null) continue;
      if (claimed.some((c) => near(c, n))) continue;
      return n; // first unclaimed number after spec = suspect
    }
  }
  return null;
}

// mutate rows in place: PASS/FAIL ที่ result = คอลัมน์ป้าย (ซ้าย spec) + มีเลข result จริงหลัง spec → SKIP
export function downgradeColumnShiftedResults(
  rows: EvaluatedItem[],
  ocrText: string
): ColumnShiftResult {
  const downgraded: { name: string; result: string; suspectAfterSpec: string }[] = [];
  if (!rows?.length || !ocrText) return { downgraded };

  const lines = ocrText.split(/\r?\n/);

  for (const r of rows) {
    if (r.status !== "PASS" && r.status !== "FAIL") continue;
    const suspect = findColumnShiftSuspect(r, lines);
    if (suspect == null) continue;

    const resRaw = (r.resultRaw ?? (r.result == null ? "" : String(r.result))).trim();
    r.status = "SKIP";
    r.needsReview = true;
    r.reason = COLUMN_SHIFT_REASON;
    downgraded.push({
      name: r.name,
      result: resRaw,
      suspectAfterSpec: String(suspect),
    });
  }
  return { downgraded };
}
