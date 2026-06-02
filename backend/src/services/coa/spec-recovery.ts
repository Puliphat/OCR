// กู้คืน "spec column" ที่โมเดลเล็ก (gemma3) หล่นทิ้งบางรัน — ทำแบบ deterministic ไม่พึ่ง LLM
//
// ★ ทำไมต้องมี ★ gemma3 ไม่เสถียร: ไฟล์เดียวกัน/โค้ดเดียวกัน บางรัน parse spec ได้ บางรัน null หมด
//   (ดู Lot240521: run เก่า 4P/1F, run ล่าสุด 5 SKIP เพราะ spec null ทั้งคอลัมน์) ทั้งที่ spec
//   ("3 Max","15 -45","45 -75","20 Max","270 ~350") อยู่ใน OCR text ครบ → ดึงเองด้วย regex
//
// ★ SAFETY (กติกาที่ทำให้ของเดิมไม่ regress) ★
//   1. เติม spec เฉพาะ row ที่ spec "ว่างสนิท" (specRaw/specMin/specMax ว่างหมด) — ไม่เคยทับของเดิม
//      → 41 PASS เดิมแตะไม่ได้ ทำได้แค่ย้าย SKIP → PASS/FAIL
//   2. ไม่ยุ่งกับ result เลย (กัน digit-concatenation / สร้าง verdict ปลอม)
//   3. assign ตาม "ลำดับเอกสาร" เมื่อจำนวน spec == จำนวน item (เคสหล่นทั้งคอลัมน์)
//      ถ้า count ไม่ตรง → จับคู่ตามชื่อแบบ unique เท่านั้น กำกวมเมื่อไร ปล่อย SKIP (ดีกว่าทายผิดแถว)
import { RawCoaItem } from "./ollama-coa.service";
import { normalizeSpec } from "./spec-normalizer";

// คำตัดสิน/ผลรวมท้ายแถวที่ต้องตัดทิ้งก่อนมองหา spec (spec อยู่ก่อนคำพวกนี้เสมอบน COA)
const JUDGMENT =
  /\b(success(?:ful)?|pass(?:ed)?|accept(?:ed|able)?|good|ok|qualified|conform(?:ed|ing)?|合格|ผ่าน)\b[\s.]*$/i;

// spec token ที่ spec-normalizer.ts อ่านออก — จับเฉพาะ "ท้ายบรรทัด" เพราะ spec อยู่ขวาสุดเสมอ
const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
const RANGE = String.raw`${NUM}\s*[-~–—〜～∼]\s*${NUM}`;
const MAXMIN = String.raw`\d+(?:[.,]\d+)?\s*(?:Max|Min)\.?`;
const BOUND = String.raw`(?:≤|≦|≥|≧|<=|>=|<|>)\s*${NUM}`;
const SPEC_TAIL = new RegExp(`(${RANGE}|${MAXMIN}|${BOUND})\\s*$`, "i");

export interface SpecRecoveryResult {
  recovered: number; // จำนวน row ที่เติม spec ได้
  mode: "none" | "ordered" | "named";
}

// ดึง spec token จาก 1 บรรทัด OCR (คืน null ถ้าไม่เจอ)
function specFromLine(line: string): string | null {
  let s = line.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(JUDGMENT, "").trim(); // ตัด "Success/ผ่าน" ท้ายออกก่อน
  s = s.replace(/[^0-9A-Za-z%.~\-–—〜～∼≤≦≥≧<>=]+$/, "").trim(); // ตัด noise ท้าย (เก็บอักขระ spec ไว้)
  const m = s.match(SPEC_TAIL);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function hasNoSpec(it: RawCoaItem): boolean {
  const blank = (v: unknown) => v == null || String(v).trim() === "";
  return blank(it.specRaw) && blank(it.specMin) && blank(it.specMax);
}

// บรรทัดที่ "เป็น data row จริง" = มีชื่อ (ตัวอักษร) นำหน้า spec ที่ท้าย
// กัน noise line ที่บังเอิญลงท้ายด้วย range/max แต่ไม่มีชื่อ (เช่น เลขลอย ๆ) ปนเข้า ordered-zip
function hasNamePrefix(cleanedLine: string): boolean {
  const beforeSpec = cleanedLine.replace(SPEC_TAIL, "");
  return /[A-Za-z฀-๿]/.test(beforeSpec); // มีตัวอักษร eng/ไทย ก่อน spec
}

// ชื่อ → token set (เก็บตัวเลขไว้ด้วย เพราะ 500/350/150 คือตัวแยกแถว sieve)
function sig(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /\d/.test(t));
}

// mutate items in place — เติม specRaw ให้ row ที่ spec ว่าง; คืนสถิติว่าเติมได้กี่อันด้วยวิธีไหน
export function recoverSpecsFromOcr(
  items: RawCoaItem[],
  ocrText: string
): SpecRecoveryResult {
  if (!items?.length || !ocrText) return { recovered: 0, mode: "none" };

  const targets = items.filter(hasNoSpec);
  if (!targets.length) return { recovered: 0, mode: "none" }; // ไม่มีอะไรต้องกู้

  // เก็บ (บรรทัด normalize, spec) เฉพาะ "data row จริง" + ตัดบรรทัดซ้ำเป๊ะออก
  // Why dedupe: Tesseract บางทีอ่านบรรทัดเดิมซ้ำ (เช่น density row โผล่ 2 ครั้ง) → ถ้าไม่ตัด
  //   จำนวน spec จะเกินจำนวน item แล้ว ordered-zip (เงื่อนไข count ตรง) จะไม่ทำงาน
  const lines = ocrText.split(/\r?\n/);
  const entries: { key: string; spec: string }[] = [];
  const seen = new Set<string>();
  for (const ln of lines) {
    const spec = specFromLine(ln);
    if (!spec) continue;
    const key = ln.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
    if (!hasNamePrefix(key)) continue; // ต้องมีชื่อ item นำหน้า
    if (seen.has(key)) continue; // บรรทัดซ้ำเป๊ะ → นับครั้งเดียว
    seen.add(key);
    entries.push({ key, spec });
  }
  if (!entries.length) return { recovered: 0, mode: "none" };

  // เคสหลัก: gemma3 หล่น spec ทั้งคอลัมน์ → ทุก item ไม่มี spec และจำนวน data-row ที่มี spec ตรงกับจำนวน item
  // → zip ตามลำดับเอกสาร (ปลอดภัยสุด เพราะ COA เรียง row บนลงล่างตรงกับ item ที่ LLM อ่าน)
  if (targets.length === items.length && entries.length === items.length) {
    items.forEach((it, i) => {
      it.specRaw = entries[i].spec;
    });
    return { recovered: items.length, mode: "ordered" };
  }

  // เคสหล่นบางแถว: จับคู่ตามชื่อแบบ unique เท่านั้น (กัน graft spec ผิดแถว)
  let recovered = 0;
  for (const it of targets) {
    const nameSig = sig(it.name ?? "");
    if (nameSig.length < 2) continue; // ชื่อสั้นเกิน เสี่ยงจับผิด → ข้าม
    const hits = new Set<string>();
    for (const ln of lines) {
      const sp = specFromLine(ln);
      if (!sp) continue;
      const lnSig = sig(ln);
      const overlap = nameSig.filter((t) => lnSig.includes(t)).length;
      if (overlap >= Math.max(2, Math.ceil(nameSig.length * 0.6))) hits.add(sp);
    }
    if (hits.size === 1) {
      it.specRaw = [...hits][0]; // จับได้แบบ unique เท่านั้นถึงเติม
      recovered++;
    }
  }
  return { recovered, mode: recovered ? "named" : "none" };
}

// ★ แก้ทิศ spec ที่ LLM assign ผิดช่อง — ต่างจาก recoverSpecsFromOcr (เติมเฉพาะ row ว่าง) ★
//
// อาการ: โมเดลเล็ก (qwen 3b) อ่าน "0.01 Max" แล้วทิ้ง "Max" ใส่ 0.01 เป็น specMin (bare) →
//   normalizeSpecFromCandidate ตีเป็น ge 0.01 → result 0.001 (ผ่านจริง) กลายเป็น FAIL ปลอม
//   (SODA "Insoluble matter"). spec-recovery แตะไม่ได้เพราะ spec "ไม่ว่าง"
//
// กติกา (ทำให้ปลอดภัย — แก้เฉพาะตอน LLM กำกวมจริง):
//   1. แตะเฉพาะ row ที่ LLM ให้ "single BARE bound": specMin XOR specMax เป็นเลขเปล่า (op=eq)
//      และไม่มี specRaw — คือเคสที่ทิศมาจาก "ช่อง" ล้วน ๆ (กำกวม) ไม่ใช่จาก operator
//   2. range (มีทั้ง min+max) / spec ที่มี operator อยู่แล้ว → ไม่แตะ (ทิศชัดเจนแล้ว)
//   3. ★ anchor ที่ "ค่าเดิมของ LLM (V) + operator ใน OCR" ★ — หาในบรรทัด OCR (จับคู่ชื่อ overlap ≥60%)
//      ว่ามี "V Max/Min" หรือ "≤/≥/</> V" ไหม. anchor ที่ V กัน grab result column (layout Item|Spec|Result)
//      ถ้าเจอ → ใช้ทิศนั้น (set specRaw). ถ้า LLM ถูกอยู่แล้ว ทิศตรงกับ OCR → ผล normalize เท่าเดิม = no-op
// คืนจำนวน row ที่แก้ทิศ
export function correctSpecDirectionFromOcr(
  items: RawCoaItem[],
  ocrText: string
): number {
  if (!items?.length || !ocrText) return 0;
  const lines = ocrText.split(/\r?\n/);

  const blank = (v: unknown) => v == null || String(v).trim() === "";
  const bareValue = (it: RawCoaItem): string | null => {
    if (!blank(it.specRaw)) return null; // มี specRaw แล้ว ทิศมักชัด — ไม่แตะ
    const minB = !blank(it.specMin);
    const maxB = !blank(it.specMax);
    if (minB === maxB) return null; // ต้อง XOR; range(min+max)/ว่าง → ข้าม
    const v = String(minB ? it.specMin : it.specMax).trim();
    return normalizeSpec(v)?.op === "eq" ? v : null; // bare number เท่านั้น
  };

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // หาทิศของค่า V ในบรรทัด: "V Max/Min" หรือ "op V" — คืน spec token (เช่น "0.01 Max", "≥ 50") หรือ null
  const directedToken = (line: string, v: string): string | null => {
    const V = esc(v);
    // ใส่ period ท้าย Min/Max เสมอ: stripUnits ใน normalizeSpec กิน "min" (time-unit) ถ้าไม่มี period
    const suffix = line.match(new RegExp(`(?<![\\d.])${V}\\s*(Max|Min)\\.?`, "i"));
    if (suffix) return `${v} ${/min/i.test(suffix[1]) ? "Min." : "Max."}`;
    const prefix = line.match(new RegExp(`(≤|≦|≥|≧|<=|>=|<|>)\\s*${V}(?![\\d.])`));
    if (prefix) return `${prefix[1]} ${v}`;
    return null;
  };

  let corrected = 0;
  for (const it of items) {
    const v = bareValue(it);
    if (!v) continue;
    const nameSig = sig(it.name ?? "");
    if (nameSig.length < 2) continue;

    const tokens = new Set<string>();
    for (const ln of lines) {
      const lnSig = sig(ln);
      const overlap = nameSig.filter((t) => lnSig.includes(t)).length;
      if (overlap < Math.max(2, Math.ceil(nameSig.length * 0.6))) continue;
      const tok = directedToken(ln, v);
      if (tok) tokens.add(tok);
    }
    if (tokens.size !== 1) continue; // ไม่เจอ / กำกวม → ปล่อยตามเดิม

    const token = [...tokens][0];
    const parsed = normalizeSpec(token);
    if (!parsed) continue;
    it.specRaw = token; // ใช้ OCR เป็นแหล่งทิศ
    it.specMin = null;
    it.specMax = null;
    corrected++;
  }
  return corrected;
}
