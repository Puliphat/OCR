// ★ Sieve/particle-size table result recovery (gated, → PASS) ★
//
// เคสจริง RI-015: ตาราง PARTICLE SIZE มีโครง `SIEVE | PATTERN | Lot#` =
//   `<aperture> | <spec> | <result>` เช่น `0.425 | 10.0 - 45.0 | 36.0`.
//   LLM หยิบ cell แรก (aperture 0.425 = ขนาดตะแกรง = ป้ายแถว) มาเป็น result ทิ้ง 36.0 จริง.
//   column-shift guard จับว่า "result = คอลัมน์ป้าย" แล้ว downgrade → honest SKIP (ปลอดภัย default).
//   โมดูลนี้ = ขั้น "กล้ากว่า": overwrite result = เลขหลัง spec → re-eval → promote เฉพาะ PASS.
//
// ★ บทเรียนจาก Opus review (รอบ overwrite แรกถูก kill) ★ — บนบรรทัด flat `X | spec | Y` แยก
//   "X = aperture/ป้าย" กับ "X = result จริงที่อยู่ซ้าย spec" ไม่ออก. ถ้า X เป็น result จริง (OOS) และ
//   Y เป็นเพื่อนบ้านที่บังเอิญ in-range → overwrite X→Y = deceptive PASS ซ่อนของเสีย (บาปหนักสุด).
//   gate ที่อิงแค่ "ชื่อ row มี sieve" กันไม่อยู่ เพราะแถวจริงชื่อ "Residue on sieve(106μm)" ก็ผ่าน.
//
// ★ QUAD GATE — promote ต่อเมื่อครบทั้ง 4 ★
//   (1) ไฟล์มีตาราง sieve/particle-size (header signature)
//   (2) ชื่อ row สื่อ sieve/particle size
//   (3) โครง aperture|spec|result บนบรรทัด OCR (result==cell[0]) — เหมือน column-shift
//   (4) ★ POSITIVE EVIDENCE: aperture ของ "ชุด candidate" เป็น series ลดหลั่น ≥3 ค่าไม่ซ้ำ ★
//       — apertures ของตะแกรงจริงเรียงเล็กลงเสมอ (2.0 > 0.85 > 0.425 > 0.15). row เดี่ยว ๆ ที่
//       cell[0] บังเอิญเป็น result จริง (เคส deceptive ของ reviewer ทุกตัวเป็น single-row) →
//       มี candidate < 3 → ไม่ผ่าน gate(4) → ไม่ promote (kill ครบ). ต้องมี ≥3 แถวที่ aperture
//       ลดหลั่นพร้อมกันถึงจะเชื่อว่า cell[0] เป็น "คอลัมน์ป้าย/ขนาดตะแกรง" จริง.
//   + promote เฉพาะ re-eval = PASS (ไม่สร้าง FAIL จากค่า reconstruct) + needsReview=true เสมอ.
//   ปิดโมดูล/ลบ = fall back honest SKIP (ไม่แย่ลง).
//
// ★ RESIDUAL RISK (Opus re-review) — gate(4) เป็น heuristic เชิงสถิติ ไม่ใช่ proof ★
//   "col0 เรียงลดหลั่น ⇒ เป็น aperture" แยกไม่ออกจาก "result จริงเรียงลดหลั่น" (retained-% ลดตามตะแกรง).
//   ตาราง residue หลายแถวที่ layout เป็น `result(OOS) | spec | เพื่อนบ้าน(in-range)` + result เรียงลด
//   + ชื่อมี sieve → ยังเจาะ gate(4) ได้ (uncommon บน COA จริง: ต้อง result-ซ้าย-spec + ≥3 แถวลดหลั่น
//   + ทุกแถว OOS พร้อมเพื่อนบ้าน in-range). ★ ตาข่ายกันสุดท้าย = needsReview=true → frontend render
//   amber "ต้องตรวจ" + กันออกจาก headline "ผ่าน" ★ — เคสที่หลุดถูก "เปิดให้คนตรวจ" ไม่ใช่ "เขียวเงียบ".
//   ห้ามแก้ frontend ให้ needsReview PASS โชว์เขียวล้วน/นับเป็น clean pass (จะกลายเป็น deceptive จริง).
//   auto→PASS แบบไม่ต้อง review = ต้อง structural extractor (Docling) อ่านหัวคอลัมน์จริง.
import { EvaluatedItem, evaluateItem } from "./coa-evaluator";
import { findColumnShiftSuspect, singleNumberCell } from "./column-shift-recovery";

export const SIEVE_RECOVERY_REASON =
  "ค่าผลนี้ระบบอ่านจากตารางร่อนตะแกรง (sieve) ให้เอง — เทียบกับใบจริง";

export interface SieveRecoveryResult {
  recovered: { name: string; from: string; to: string }[];
}

export interface MissingSieveResult {
  added: { name: string; spec: string; result: string; status: string }[];
}

// gate (1) ระดับไฟล์: OCR มี signature ของตาราง sieve/particle-size ไหม
export function isSieveTable(ocrText: string): boolean {
  return (
    /particle\s*size/i.test(ocrText) ||
    (/\bsieve\b/i.test(ocrText) && /\bpattern\b/i.test(ocrText))
  );
}

// gate (2) ระดับแถว: ชื่อ row สื่อว่าเป็นแถวในตาราง sieve/particle-size
function isSieveRowName(name: string): boolean {
  return /particle\s*size|sieve/i.test(name);
}

// aperture ที่ LLM ใช้เป็น result: เลขล้วน หรือ bound "<0.150"/"≤X" → คืนค่าตัวเลขขอบ; ไม่ใช่ → null
function apertureNum(cell: string): number | null {
  const t = cell.replace(/\s+/g, "");
  const n = singleNumberCell(t);
  if (n != null) return n;
  const m = t.match(/^[<>≤≥≦≧]=?(-?\d+(?:[.,]\d+)?)$/);
  if (m) return Number(m[1].replace(",", "."));
  return null;
}

// ★ gate (4) positive evidence ★ — apertures (ตามลำดับแถว) เป็น series ลดหลั่น ≥3 ค่าไม่ซ้ำไหม
export function isDescendingApertureSeries(aps: number[]): boolean {
  if (aps.length < 3) return false;
  for (let i = 1; i < aps.length; i++) {
    if (aps[i] > aps[i - 1] + 1e-9) return false; // non-increasing
  }
  const distinct = new Set(aps.map((v) => Math.round(v * 1e6) / 1e6));
  return distinct.size >= 3;
}

// mutate rows in place: SKIP sieve rows ที่ result = aperture (series ยืนยันแล้ว) → result จริง → PASS
export function recoverSieveTableResults(
  rows: EvaluatedItem[],
  ocrText: string
): SieveRecoveryResult {
  const recovered: { name: string; from: string; to: string }[] = [];
  if (!rows?.length || !ocrText || !isSieveTable(ocrText)) return { recovered }; // gate (1)

  const lines = ocrText.split(/\r?\n/);

  // 1) รวบ candidate: SKIP + ชื่อ sieve (gate 2) + โครง aperture|spec|result (gate 3)
  const cands: { r: EvaluatedItem; apOfRow: number; suspect: number }[] = [];
  for (const r of rows) {
    if (r.status !== "SKIP") continue;
    if (!isSieveRowName(r.name)) continue;
    const apOfRow = apertureNum(r.resultRaw ?? (r.result == null ? "" : String(r.result)));
    if (apOfRow == null) continue;
    const suspect = findColumnShiftSuspect(r, lines);
    if (suspect == null) continue;
    cands.push({ r, apOfRow, suspect });
  }

  // 2) gate (4): apertures ของ candidate ต้องเป็น series ลดหลั่น ≥3 — ไม่ผ่าน = ไม่ promote ทั้งใบ
  if (!isDescendingApertureSeries(cands.map((c) => c.apOfRow))) return { recovered };

  // 3) promote แต่ละ candidate
  for (const { r, suspect } of cands) {
    const re = evaluateItem({
      name: r.name,
      unit: r.unit,
      method: r.method,
      specRaw: r.specRaw,
      result: String(suspect),
    });
    // promote เป็น PASS เมื่อ result จริงเข้า spec — รวมเคส "ค่าตรงขอบ range" (เช่น 0.0% retained =
    //   spec.min) ที่ evaluateItem ดักเป็น SKIP (anti-fabricated-PASS). ในตาราง sieve result มาจาก cell
    //   คนละช่องกับ spec จริง → boundary coincidence = ของจริง → PASS ได้. re-eval นอกช่วง → ปล่อย SKIP
    const within =
      re.min != null && re.max != null && suspect >= re.min && suspect <= re.max;
    if (!(re.status === "PASS" || (re.status === "SKIP" && within))) continue;

    const from = r.resultRaw ?? (r.result == null ? "" : String(r.result));
    const finalVal = re.result != null ? re.result : suspect;
    r.status = "PASS";
    r.result = finalVal;
    r.resultRaw = String(finalVal); // ★ sync resultRaw (อย่าให้ค้าง aperture เดิม → UI/DB เพี้ยน) ★
    r.min = re.min;
    r.max = re.max;
    r.reason = SIEVE_RECOVERY_REASON;
    r.needsReview = true; // ★ ค่ามาจาก reconstruct — ให้คนยืนยันใบจริงเสมอ ★
    recovered.push({ name: r.name, from, to: String(finalVal) });
  }
  return { recovered };
}

// ★ Missing bare-eq sieve-row recovery (gated → add SKIP+amber, แทรกตำแหน่งจริง) ★ — RI-015 `2.000|0.0|0.0`
//   LLM ทิ้งแถวที่ spec+result เป็นค่าเดียวเท่ากัน (มองเป็นว่าง). scope แคบ = เฉพาะ bare-eq (min===max) +
//   result==ค่า → range row ไม่ถูกแตะ (กัน add ซ้ำ). GATE: sieve table + apertures ลดหลั่น ≥3 (อ่าน OCR ตรง).
//   ★ คง SKIP+amber เสมอ (ไม่ promote PASS — Opus: bare-eq ทิศไม่รู้) ★ เป้า = ให้แถวที่หาย "แสดง" บน UI
export function recoverMissingSieveRows(
  rows: EvaluatedItem[],
  ocrText: string
): MissingSieveResult {
  const added: MissingSieveResult["added"] = [];
  if (!rows?.length || !ocrText || !isSieveTable(ocrText)) return { added }; // gate (1)

  // parse OCR pipe rows: cell0 = aperture(number) · cell สุดท้าย = result(number) · กลาง = spec
  const parsed: { ap: number; specRaw: string; resVal: number }[] = [];
  for (const line of ocrText.split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 3) continue;
    const ap = apertureNum(cells[0]);
    if (ap == null) continue;
    const resVal = singleNumberCell(cells[cells.length - 1].replace(/\s+/g, ""));
    if (resVal == null) continue;
    const specRaw = cells.slice(1, cells.length - 1).join(" ").trim();
    if (!specRaw) continue;
    parsed.push({ ap, specRaw, resVal });
  }

  // gate (2): apertures ลดหลั่น ≥3 → ยืนยันเป็นตาราง sieve จริง (ไม่ใช่เลขสุ่ม)
  if (!isDescendingApertureSeries(parsed.map((p) => p.ap))) return { added };

  const sieveName = rows.find((r) => isSieveRowName(r.name))?.name ?? "Particle Size";
  const firstSieveIdx = rows.findIndex((r) => isSieveRowName(r.name)); // จุดแทรก = บนสุดกลุ่ม sieve

  for (const p of parsed) {
    const re = evaluateItem({ name: sieveName, specRaw: p.specRaw, result: String(p.resVal) });
    // ★ scope: เฉพาะ bare-eq (min===max) ที่ result==ค่า — แบบ 0.0/0.0 ที่ LLM ทิ้ง. range row ไม่แตะ ★
    if (re.min == null || re.max == null || re.min !== re.max) continue;
    if (p.resVal !== re.min) continue;
    // dedup: มี sieve row ที่ bare-eq ค่าเดียวกัน + result เดียวกันแล้วไหม (numeric, ข้าม result=null)
    const dup = rows.some(
      (E) =>
        isSieveRowName(E.name) &&
        E.min === re.min &&
        E.max === re.max &&
        E.result != null &&
        Number(E.result) === p.resVal
    );
    if (dup) continue;
    // ★ คง SKIP+amber เสมอ (ไม่ promote PASS) — bare-eq ทิศไม่รู้ → ไม่ตัดสิน (Opus: กัน deceptive PASS) ★
    //   เป้าหมาย = แค่ให้แถวที่ LLM ทิ้ง "แสดง" บน UI (amber ต้องตรวจ) ไม่ใช่ดันให้ผ่าน
    const item: EvaluatedItem = {
      ...re,
      status: "SKIP",
      result: p.resVal,
      resultRaw: String(p.resVal),
      reason: SIEVE_RECOVERY_REASON,
      needsReview: true, // ★ แถว reconstruct — ให้คนยืนยันใบจริงเสมอ (amber ไม่เขียวเงียบ) ★
    };
    const at = firstSieveIdx >= 0 ? firstSieveIdx : rows.length;
    rows.splice(at, 0, item); // แทรกบนสุดของกลุ่ม sieve (ไม่ append ท้าย)
    added.push({ name: sieveName, spec: p.specRaw, result: String(p.resVal), status: item.status });
  }
  return { added };
}
