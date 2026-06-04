// ★ กู้คืน "result" ที่โมเดลเล็ก (qwen3:4b) หล่นทิ้งบางรัน — deterministic, ไม่พึ่ง LLM ★
//
// อาการ (เคสจริง ZP10): OCR อ่าน result ครบทุกแถว แต่ LLM คาย JSON โดย "ไม่มี key result"
//   (row 2-4: Fiber Length 1.09, Specific Surface Area 9.31, Moisture 6.2) → result=null → SKIP
//   "result not numeric" ทั้งที่ค่าอยู่ใน OCR ครบ.
//
// ★ ทำไมเสี่ยงกว่า spec-recovery (ซึ่งจงใจไม่แตะ result — ดู spec-recovery.ts หัวไฟล์) ★
//   เติม result ผิด = สร้าง verdict ปลอม (deceptive PASS/FAIL = บาปหนักสุดของ QA). ดังนั้นกติกาเข้ม:
//   เติมก็ต่อเมื่อ "บนบรรทัด OCR ของ row นั้นเอง เหลือ 'cell ตัวเลขเดี่ยว' ผู้สมัครเพียงตัวเดียว"
//   หลังตัด cell ที่เป็น spec / method / unit / เลขในชื่อ ออกแล้ว. กำกวม (0 หรือ ≥2) → ปล่อยว่าง
//   (honest SKIP). + ปลายทางยังมี pass-guard/fail-guard re-check co-location อีกชั้น.
//
// ★ SAFETY (กติกาที่ทำให้ของเดิมไม่ regress) ★
//   1. เติมเฉพาะ row ที่ result "ว่างสนิท" — ไม่เคยทับของเดิม → PASS/FAIL เดิมแตะไม่ได้ ทำได้แค่ย้าย SKIP
//   2. row ต้องมี spec อยู่แล้ว (จะ evaluate ได้จริง) — ไม่งั้นเติม result ไปก็ SKIP อยู่ดี + เพิ่มความเสี่ยงเปล่า
//   3. anchor บรรทัดด้วยชื่อ row (overlap ≥60%, ต้อง unique) — หาบรรทัดไม่เจอ/กำกวม → ข้าม
//   4. ผู้สมัคร = "cell ที่เป็นตัวเลขเดี่ยวล้วน" เท่านั้น (กัน range/method/text) และต้องเหลือตัวเดียว
import { RawCoaItem } from "./ollama-coa.service";

export interface ResultRecoveryResult {
  recovered: number;
  names: string[]; // ชื่อ row ที่ถูกเติม result — pipeline ใช้ตั้ง needsReview (PASS จาก recovery อย่าเงียบมั่นใจ)
}

// EU decimal (0,28 → 0.28) vs US thousands (1,000 → 1000) — sync กับ normalizer ตัวอื่น
function toNum(s: string): number {
  let c = s.trim();
  if (c.includes(",") && !c.includes(".")) c = c.replace(/,/g, ".");
  else c = c.replace(/,/g, "");
  return Number(c);
}

const digitsOnly = (s: string) => s.replace(/[^\d]/g, "");

// ชื่อ/บรรทัด → token set (เก็บตัวเลขไว้ เพราะ 500/350/150 = ตัวแยกแถว) — sync กับ spec-recovery sig()
function sig(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /\d/.test(t));
}

// แยก cell ใน 1 บรรทัด OCR: ใช้ "|" (reconstructText join ด้วย " | ") ก่อน, ไม่มีก็ split ด้วย ≥2 space
function splitCells(line: string): string[] {
  const parts = line.includes("|") ? line.split("|") : line.split(/\s{2,}/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// cell เป็น "ตัวเลขเดี่ยวล้วน" ไหม (ตัด whitespace ภายในที่ OCR แทรก เช่น "1. 09" → "1.09")
//   คืน number ถ้าใช่, null ถ้าไม่ (range "6.00-11.00", method "TAPPI 271", text → null)
function singleNumberCell(cell: string): number | null {
  const t = cell.replace(/\s+/g, "");
  if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) return null;
  const n = toNum(t);
  return Number.isNaN(n) ? null : n;
}

// เลขทุกตัว (value+digit-string) ที่ "ถูกจองแล้ว" จาก field อื่นของ item (spec/method/unit/name)
function claimedNumbers(it: RawCoaItem): { vals: number[]; digits: Set<string> } {
  const src = [it.specRaw, it.specMin, it.specMax, it.method, it.unit, it.name]
    .filter((v) => v != null)
    .map((v) => String(v))
    .join(" ");
  const toks = src.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  const vals: number[] = [];
  const digits = new Set<string>();
  for (const t of toks) {
    const n = toNum(t);
    if (!Number.isNaN(n)) vals.push(n);
    digits.add(digitsOnly(t));
  }
  return { vals, digits };
}

const blank = (v: unknown) => v == null || String(v).trim() === "";

// result ว่างสนิทไหม (null / "" / object ที่ทุก field ว่าง)
function resultBlank(it: RawCoaItem): boolean {
  const r = it.result;
  if (r == null) return true;
  if (typeof r === "object") {
    const o = r as Record<string, unknown>;
    return [o.avg, o.min, o.max, (o as any).raw].every((x) => blank(x));
  }
  return String(r).trim() === "";
}

function hasSpec(it: RawCoaItem): boolean {
  return !blank(it.specRaw) || !blank(it.specMin) || !blank(it.specMax);
}

// mutate items in place — เติม result ให้ row ที่ result ว่าง + spec มี + เจอผู้สมัครตัวเลขเดี่ยวบนบรรทัดตัวเอง
export function recoverResultsFromOcr(
  items: RawCoaItem[],
  ocrText: string
): ResultRecoveryResult {
  if (!items?.length || !ocrText) return { recovered: 0, names: [] };

  const lines = ocrText.split(/\r?\n/);
  const lineSets = lines.map((l) => new Set(sig(l)));

  let recovered = 0;
  const names: string[] = [];
  for (const it of items) {
    if (!resultBlank(it) || !hasSpec(it)) continue;

    const nameSig = sig(it.name ?? "");
    if (nameSig.length < 2) continue; // ชื่อสั้น/กำกวม → ข้าม

    // หาบรรทัด overlap สูงสุด (threshold เดียวกับ spec-recovery) + ต้อง unique
    const need = Math.max(2, Math.ceil(nameSig.length * 0.6));
    const scores = lineSets.map((ls) => nameSig.filter((t) => ls.has(t)).length);
    const best = scores.reduce((a, b) => (b > a ? b : a), 0);
    if (best < need) continue;
    if (scores.filter((s) => s === best).length !== 1) continue; // กำกวมหลายบรรทัด → ข้าม
    const line = lines[scores.indexOf(best)];

    // ผู้สมัคร = cell ตัวเลขเดี่ยว ที่ไม่ใช่เลขของ spec/method/unit/name
    const { vals, digits } = claimedNumbers(it);
    const isClaimed = (n: number) =>
      vals.some((v) => Math.abs(v - n) < 1e-9) || digits.has(digitsOnly(String(n)));

    const cands: number[] = [];
    for (const cell of splitCells(line)) {
      const n = singleNumberCell(cell);
      if (n == null) continue;
      if (isClaimed(n)) continue;
      if (!cands.some((c) => Math.abs(c - n) < 1e-9)) cands.push(n);
    }
    if (cands.length !== 1) continue; // 0 = ไม่เจอ, ≥2 = กำกวม → ปล่อยว่าง (honest SKIP)

    it.result = String(cands[0]);
    recovered++;
    names.push((it.name ?? "").trim());
  }
  return { recovered, names };
}
