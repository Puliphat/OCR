// ★ Anti-hallucination guard ★ — ตัด row ที่ "ไม่มีอยู่จริงในเอกสาร" ออกก่อน evaluate
//
// อาการที่กัน (เคสจริง 1F1710): OCR เอกสารเป็น pulp COA (freeness/fiber/moisture) แต่ LLM ปั้น
//   ทั้งใบเป็น metal COA (Tin/Iron/Manganese + "DUPONT Method") ที่ไม่มีในเอกสารเลย → PASS ปลอม 3 แถว
//   needsReview=false = มั่นใจแบบผิด ๆ = บาปหนักสุด (ส่งงานบอก "ผ่าน" จากข้อมูลที่ไม่มีจริง)
//
// grounded เมื่อ "ตรวจย้อนไป OCR ได้" ทางใดทางหนึ่ง:
//   1. name grounded — ชื่อ row โผล่ใน OCR (whole-word latin หรือ substring ≥5 ตัว เผื่อไทย/ชื่อยาว)
//   2. number co-located — result และ spec ต้องโผล่ "บรรทัด OCR เดียวกัน" (= แถวตารางจริงอยู่บรรทัดเดียว)
//   ไม่เข้าทั้งสอง → ถือว่าปั้น → drop
//
// ★ ทำไม co-location ★ เอกสาร number-dense (multi-batch) ค่า hallucinate มักบังเอิญชนเลขจริง "คนละที่"
//   (1F1710: result 0.42 + spec 0.5 มีอยู่จริงแต่คนละบรรทัด) → ถ้าเช็คแค่ "มีในเอกสาร" จะปั้นรอด
//   แถวจริง result+spec อยู่บรรทัดเดียวกันเสมอ → บังคับ co-location ตัดความบังเอิญทิ้ง
//
// ★ SAFETY ★ row จริงชื่ออยู่ใน OCR → ผ่านทาง name (short-circuit) ไม่แตะ number เลย
//   number path เป็น fallback เฉพาะแถวที่ชื่อเพี้ยน/non-latin → drop = miss (honest) ไม่ใช่ false verdict
import { RawCoaItem } from "./ollama-coa.service";

export interface GroundingResult {
  kept: RawCoaItem[];
  dropped: { name: string; reason: string }[];
}

interface NumToken {
  val: number;
  digits: string;
}

// alpha token (≥3) ของชื่อ — ตัดเลข/อักขระทิ้ง, lower-case (รับ latin + ไทย)
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z฀-๿]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
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
  return (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((t) => ({
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

// 1 row grounded ไหม
function isGrounded(
  item: RawCoaItem,
  ocrWords: Set<string>,
  ocrNoSpace: string,
  lineTokens: NumToken[][]
): boolean {
  // 1. name grounding — whole-word (latin) หรือ substring เฉพาะ token ยาว ≥5 (เผื่อไทย/ชื่อยาว)
  //    ไม่ substring token สั้น (3-4) กัน "tin" ไปแมตช์ "testing", "iron" แมตช์ "environment"
  for (const t of nameTokens(item.name ?? "")) {
    if (ocrWords.has(t)) return true;
    if (t.length >= 5 && ocrNoSpace.includes(t)) return true;
  }
  // 2. number co-location — result และ spec ต้องอยู่ "บรรทัดเดียวกัน"
  const resultNums = numberTokens(item.result);
  const specNums = [
    ...numberTokens(item.specRaw),
    ...numberTokens(item.specMin),
    ...numberTokens(item.specMax),
  ];
  if (!resultNums.length || !specNums.length) return false;
  for (const lt of lineTokens) {
    if (!lt.length) continue;
    const rHit = resultNums.some((n) => numberMatches(n, lt));
    const sHit = specNums.some((n) => numberMatches(n, lt));
    if (rHit && sHit) return true;
  }
  return false;
}

// ตัด row ที่ไม่มี grounding ใน OCR (น่าจะ LLM ปั้น) — คืนชุดใหม่ (ไม่ mutate)
export function dropUngroundedItems(
  items: RawCoaItem[],
  ocrText: string
): GroundingResult {
  if (!items?.length || !ocrText) return { kept: items ?? [], dropped: [] };

  // latin word set (whole-word name match)
  const ocrWords = new Set(
    ocrText.toLowerCase().match(/[a-z]{3,}/g) ?? []
  );
  const ocrNoSpace = ocrText.toLowerCase().replace(/\s+/g, "");
  // number token ต่อบรรทัด (co-location)
  const lineTokens = ocrText.split(/\r?\n/).map(parseNumTokens);

  const kept: RawCoaItem[] = [];
  const dropped: { name: string; reason: string }[] = [];
  for (const it of items) {
    if (isGrounded(it, ocrWords, ocrNoSpace, lineTokens)) {
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
