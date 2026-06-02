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
      // ★ ต้องครบทุก bound ★ — spec ทั้งหมด (min+max ของ range) ต้องอยู่บรรทัด result เดียวกัน
      //   ใช้ .every กัน "range ประกอบข้ามแถว": LLM เล็กชอบ comma-join cell คนละคอลัมน์
      //   (เคสจริง _diag/Lot240521 350μ: spec จริง "15~45" แต่ LLM ได้ "45~56" โดย 56 ยกมาจากแถว 150μ)
      //   .some เดิมปล่อยผ่านเพราะ 45 บังเอิญอยู่บรรทัด result → fabricated FAIL รอด. .every จับได้
      const sHit = specNums.every((n) => numberMatches(n, lt));
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

// ★ Anti-deceptive-PASS guard (column collapse, PASS side) ★ — คู่แฝดของ downgradeUngroundedFails
//   แต่ฝั่ง PASS. false-PASS = บาปหนักสุดของ QA (บอก "ผ่าน" จาก spec/result ที่ไม่ใช่ของแถวนั้นจริง)
//
// อาการ (เคสจริง Lot240521 item1): ตาราง transposed, OCR อ่านถูก
//   "Sieve Residue on 500 μ(%) | 0.3 | 3 Max. | Success"  (result จริง 0.3, spec จริง ≤3)
//   แต่ LLM ดึงเลขข้ามบรรทัด → result 42 / specMax 45 (ยกจากแถว 350μ) → 42 ≤ 45 = PASS ปลอม
//
// ★ ทำไม name-anchored (ไม่ใช่ any-line แบบ fail-guard) ★ — เอกสาร number-dense ค่าผิดของ item1
//   (42, 45) ดันไป co-locate "บรรทัดของ item2" พอดี → เช็คแบบ any-line จะปล่อยผ่าน (false PASS รอด)
//   ต้อง anchor บรรทัดที่ "เป็นของ row นี้จริง" = บรรทัด OCR ที่ overlap ชื่อมากสุด
//   (เลข 500/350/150 ในชื่อเป็นตัวแยกแถว sieve → ดึงบรรทัดถูกตัว)
//
// กติกา (ปลอดภัย — เช็คเฉพาะ "result co-location" + ต้องเป็น data line จริง เพื่อลด false SKIP):
//   1. แตะเฉพาะ PASS. FAIL มี fail-guard แล้ว, SKIP ไม่ต้องยุ่ง
//   2. ต้อง anchor ได้จริง: ชื่อมี ≥2 token (รวมเลข) + เจอบรรทัด OCR ที่ overlap ผ่าน threshold
//      (เดียวกับ spec-recovery). anchor ไม่ได้ → ปล่อย PASS (พิสูจน์ collapse ไม่ได้ = honest miss)
//   3. เช็ค RESULT co-locate บน "บรรทัด anchor" (overlap สูงสุด, ties เก็บหมด) ด้วย exact value (ไม่ใช่ digit-string)
//      + spec: เช็ค co-locate เฉพาะ single-bound (Max/Min/≤/≥/=) ที่ bound โผล่ตรงตัวใน OCR
//      ★ between/± ข้าม spec check ★ เพราะ normalize เป็น min/max "คำนวณขึ้น" (7±3 → 4,10) ไม่มีใน OCR
//      (เช็คจะ false-SKIP เช่น Viscosity 6.6 ใน 7±3). single-bound เช็คได้ → กัน borrowed-spec PASS ปลอม
//   4. ★ บรรทัด anchor ต้องมี "data number" (เลขที่ไม่ใช่เลขฝังในชื่อ เช่น 500/106) ★ ถึงจะถือเป็น "บรรทัด data จริง"
//      ถ้าบรรทัดชื่อไม่มี data number = ชื่อถูก OCR ตัดมา/เป็น header (เช่น "Canadian Standard" ที่จริงคือ
//      "Canadian Standard Freeness" ตัด 2 บรรทัด, "pH\n(Aqueous Solution)") → ค่าจริงอยู่บรรทัด continuation
//      → พิสูจน์ collapse ไม่ได้ → ปล่อย PASS (กัน false SKIP จากชื่อ wrap)
//   → downgrade เฉพาะเมื่อ "บรรทัดชื่อมีค่า data ของตัวเอง แต่ result ที่ LLM ให้ไม่ใช่ค่านั้น" = ยกเลขมาจากแถวอื่นจริง
export interface PassGuardResult {
  downgraded: { name: string; reason: string }[];
}

export const PASS_DOWNGRADE_REASON =
  "PASS แต่ค่า result ไม่อยู่บรรทัดข้อมูลของชื่อ row ใน OCR — น่าจะ column collapse (LLM ยกเลขมาจากแถวอื่น) ตรวจใบจริง";

// token ของชื่อสำหรับ anchor — เก็บเลขไว้ (500/350/150 คือตัวแยกแถว sieve), lower-case latin+digit
function anchorTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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

  for (const r of rows) {
    if (r.status !== "PASS") continue;

    const nameSig = anchorTokens(r.name);
    if (nameSig.length < 2) continue; // ชื่อสั้น/glued → anchor ไม่ชัด → ปล่อย (conservative)

    // หาบรรทัด overlap สูงสุด (= บรรทัดของ row นี้). threshold เดียวกับ spec-recovery
    const need = Math.max(2, Math.ceil(nameSig.length * 0.6));
    const scores = lineSigs.map((ls) => nameSig.filter((t) => ls.has(t)).length);
    const bestScore = scores.reduce((a, b) => (b > a ? b : a), 0);
    if (bestScore < need) continue; // หาบรรทัดของ row นี้ไม่เจอ → พิสูจน์ collapse ไม่ได้ → ปล่อย

    const resultNums = [
      ...numberTokens(r.resultRaw).map((s) => Number(s.replace(/,/g, "."))),
      ...(r.result != null ? [r.result] : []),
    ].filter((n) => !Number.isNaN(n));
    if (!resultNums.length) continue; // ไม่มีเลข result ให้เทียบ → ปล่อย

    // ★ spec co-location เฉพาะ single-bound (Max/Min/≤/≥/=) — bound โผล่ตรงตัวใน OCR ★
    //   between/± (min≠max) ข้าม: bound บางตัวเป็นค่าคำนวณ (7±3 → min4 max10) ไม่มีใน OCR → เช็คจะ false-SKIP
    //   กัน "borrowed-spec PASS": result ถูกแต่ LLM ยืม bound หลวมจากแถวอื่น (เช่น 12 ใต้ spec จริง 10 Max
    //   แต่ได้ 50 Max มา → 12≤50 PASS ปลอม ทั้งที่จริง FAIL) → bound 50 ไม่อยู่บรรทัดนี้ → จับได้
    const isBetween = r.min != null && r.max != null && r.min !== r.max;
    const boundVal = isBetween ? null : r.max != null ? r.max : r.min;

    const nameNums = nameEmbeddedDigits(r.name);
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

    // บรรทัดชื่อมี data number ของตัวเอง แต่ result/bound ที่ LLM ให้ไม่ตรง → ยกเลขมาจากแถวอื่น (deceptive)
    r.status = "SKIP";
    r.needsReview = true;
    r.reason = PASS_DOWNGRADE_REASON;
    downgraded.push({ name: r.name, reason: PASS_DOWNGRADE_REASON });
  }
  return { downgraded };
}
