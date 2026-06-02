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
import { EvaluatedItem } from "./coa-evaluator";

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

// ★ Anti-fabricated-FAIL guard (column collapse) ★ — downgrade FAIL ที่ spec ไม่ใช่ของแถวตัวเอง
//
// อาการ (เคสจริง Lot240521, Suzorite): scan/text-layer ตาราง transposed (ชื่อ/spec/result คนละบรรทัด)
//   หรือ scan เอียง → LLM map spec ผิด เอา spec ค่าเดียว broadcast ทุกแถว
//   (Lot240521: "20 Max" ×3 แถว sieve · Suzorite: "92~100" ×3 ทั้งที่จริง +100=Max1, -100/+200=Max5)
//   → result ตกนอก spec ที่ "ไม่ใช่ของตัวเอง" → FAIL ปลอม needsReview=false = บอกของเสียทั้งที่ไม่รู้จริง
//
// กติกา: FAIL row คง verdict ได้ ต่อเมื่อ spec กับ result โผล่ "บรรทัด OCR เดียวกัน"
//   (= เป็นแถวตารางจริง result ถูกเทียบกับ spec ที่อยู่ข้างกันจริง ไม่ใช่ spec ที่ยกมาจากแถวอื่น)
//   ไม่ co-locate → downgrade FAIL → SKIP + needsReview (honest "ตรวจใบจริง" ดีกว่า fabricated FAIL)
//
// ★ SAFETY ★ แตะเฉพาะ status FAIL (would-be bad verdict) — PASS/SKIP ไม่ยุ่ง
//   true FAIL ในตารางปกติ (name|spec|result บรรทัดเดียว) → spec+result co-locate → คง FAIL ไว้
//   ใช้ numberMatches แบบ whole-token (เลขเท่ากัน/digit-string เท่ากัน) ตัดความบังเอิญ substring
export interface FailGuardResult {
  downgraded: { name: string; reason: string }[];
}

export const FAIL_DOWNGRADE_REASON =
  "spec กับ result อยู่คนละบรรทัด OCR — น่าจะ column collapse (spec ยกมาจากแถวอื่น) ตรวจใบจริง";

// mutate rows in place: FAIL ที่ spec+result ไม่ co-locate → SKIP. คืนรายการที่ downgrade
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
      const sHit = specNums.some((n) => numberMatches(n, lt));
      if (rHit && sHit) {
        colocated = true;
        break;
      }
    }
    if (colocated) continue;

    r.status = "SKIP";
    r.needsReview = true;
    r.reason = FAIL_DOWNGRADE_REASON;
    downgraded.push({ name: r.name, reason: FAIL_DOWNGRADE_REASON });
  }
  return { downgraded };
}
