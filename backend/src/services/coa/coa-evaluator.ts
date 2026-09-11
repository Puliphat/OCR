// Deterministic evaluator — รับ JSON จาก LLM แล้วตัด PASS/FAIL/SKIP ต่อ row
// Logic ไม่พึ่ง LLM เลย เปลี่ยน rule ที่นี่ได้โดยไม่ต้อง re-run pipeline
import { ParsedSpec, normalizeSpecFromCandidate } from "./spec-normalizer";
import { normalizeResult, ResultValues } from "./result-normalizer";
import { hasUnpinnedAmbiguity, pickScale, readAsThousands, siblingMagnitude } from "./numeric";

export type Status = "PASS" | "FAIL" | "SKIP";

export interface CoaItemInput {
  name?: string | null;
  unit?: string | null;
  method?: string | null;
  specRaw?: string | null;
  specMin?: string | number | null;
  specMax?: string | number | null;
  result?: string | number | ResultValues | null;
  // ★ result แบบ 2 คอลัมน์ (Results Min | Results Max) — ใบที่ไม่มีคอลัมน์ result เดี่ยว เช่น RB220 ★
  //   ครบคู่ = ค่าที่วัดได้เป็นช่วง → ต้องอยู่ในกรอบ spec ทั้งช่วง (ดู evaluateInterval)
  resultMin?: string | number | null;
  resultMax?: string | number | null;
  // โมดูล structural อ่านเกณฑ์มาจากช่องของมันเองในตาราง (ไม่ใช่ LLM คัดลอกค่าผลมาเป็นเกณฑ์)
  //   ★ ตั้งได้เฉพาะโมดูลที่นับช่องแล้วถอยเมื่อจำนวนไม่ตรง ★ ห้ามตั้งจากโมดูลที่ match ชื่อแถวแล้วอ่านช่องข้างๆ
  specFromCell?: boolean;
}

export interface EvaluatedItem {
  name: string;
  unit: string | null;
  method: string | null;
  min: number | null;
  max: number | null;
  result: number | null;
  status: Status;
  reason: string;
  specRaw: string | null;
  resultRaw: string | null;
  needsReview: boolean; // ธงเตือนคน: ค่าน่าสงสัยว่า OCR ทศนิยมหาย (ไม่เปลี่ยน PASS/FAIL)
  // result แบบช่วง (2 คอลัมน์) — null/ไม่มี เมื่อ result เป็นค่าเดี่ยวตามปกติ (optional: test helper สร้าง row บางส่วน)
  //   result (ด้านบน) = "ขอบที่ตัดสิน" (binding bound) ของช่วงนี้ → guard/margin ที่คิดบนเลขเดี่ยวยังทำงานถูกทาง
  resultMin?: number | null;
  resultMax?: number | null;
  // แถวนี้ spec มาจาก DuPont double-min/max layout (spec-column-recovery) — ใช้เป็นเป้าของ
  //   cross-page reconciliation เท่านั้น (เอกสารซ้ำบล็อกเดิมหลายหน้า → หน้ายันกันเองได้)
  specDupont?: boolean;
  // แถวนี้มีตัวเลข comma ที่อ่านได้ 2 ทาง (ดู hasAmbiguousThousands) — verdict ยืนบนสมมติฐาน "comma = ทศนิยม"
  //   ค่าอาจเพี้ยน 1000 เท่า → margin ไม่มีความหมาย (margin-green ห้ามล้างธงนี้ ดู applyMarginGreen G5)
  ambiguousThousands?: boolean;
  // แถวนี้ระบบประกอบเองจากตำแหน่งช่องในตาราง (lot-row-table / paren-spec) ไม่ได้มาจาก LLM
  //   คอลัมน์เป็นการอนุมาน → ธงต้องติดถาวร ห้ามให้ margin-green ล้าง
  columnRebuilt?: boolean;
  // OCR 2 รอบอ่านเลขแถวนี้ไม่เหมือนกัน (ดู flagChallengerPasses) — ยังไม่รู้ว่าเลขไหนคือเลขบนใบ
  //   ด่านที่ล้างธงทุกตัวต้องข้ามแถวนี้ (margin-green G6, dupont cross-page) ไม่งั้นเลขที่เถียงกันขึ้นจอเขียว
  valueDisputed?: boolean;
  // ช่องข้อมูลในบล็อกที่ใบไม่มีคอลัมน์เกณฑ์เลย (Chemical Element ของ TAIHEIYO) — ไม่มีอะไรให้เทียบ
  //   จอ/CLI โชว์แยกเป็นค่าอ่านอย่างเดียว ไม่นับเป็นรายการตรวจ (ตั้งที่ transposed-label-recovery)
  infoOnly?: boolean;
}

// ★ Ambiguous thousands ★ — "1,500" แยกไม่ออกว่าเป็น EU decimal (1.5) หรือ US thousands (1500)
//   toNum เลือก EU เสมอ (ถูกกับ corpus ปัจจุบัน) แล้วหา anchor พินสเกล 2 ชั้นก่อนค่อยยกธง
//   ยกธงเฉพาะที่ตัดสินไม่ได้จริง (ธงเยอะ = คนตรวจซ้ำหมด = OCR ไม่ได้ลดงาน) — ชั้น 1 เลขอื่นในกลุ่ม · ชั้น 2 ขอบเกณฑ์
export function evaluateItem(item: CoaItemInput): EvaluatedItem {
  const core = evaluateItemCore(item);

  const resultRaw =
    typeof item.result === "object" && item.result !== null
      ? (item.result as ResultValues).raw
      : item.result;
  const resultAmbiguous = hasUnpinnedAmbiguity(resultRaw, item.resultMin, item.resultMax);
  const specAmbiguous = hasUnpinnedAmbiguity(item.specRaw, item.specMin, item.specMax);
  if (!resultAmbiguous && !specAmbiguous) return core;

  // ค่าผลที่กลุ่มตัวเองพินสเกลไม่ได้ → ยืม magnitude ของ "เกณฑ์" มาตัดสิน (ทิศเดียวเท่านั้น)
  //   เกณฑ์กำกวมด้วย = ไม่มีหลักให้ยึด (และ ÷1000 ทั้ง 2 ฝั่ง verdict เท่าเดิมอยู่แล้ว) → ยกธงอย่างเดียว
  //   result เป็น object = ค่าถูก LLM แปลงเป็น number มาแล้ว เขียน token ใหม่ไม่ได้ → ยกธงอย่างเดียว
  const canRescale =
    resultAmbiguous &&
    !specAmbiguous &&
    typeof item.result !== "object" &&
    siblingMagnitude(resultRaw, item.resultMin, item.resultMax) == null;
  const reading = canRescale ? pickThousandsReading(core) : null;

  if (reading === "eu") return core; // magnitude ยืนยันว่าเป็นทศนิยม = ไม่กำกวมแล้ว ไม่ต้องเตือน
  if (reading === "us") {
    // อ่านใหม่เป็นหลักพันแล้วให้ core ตัดสินซ้ำทั้งเส้น (ไม่มี logic ขนาน) · resultRaw คงข้อความบนใบไว้
    const rescaled = evaluateItemCore({
      ...item,
      result: readAsThousands(item.result),
      resultMin: readAsThousands(item.resultMin),
      resultMax: readAsThousands(item.resultMax),
    });
    const note = `อ่าน "${core.resultRaw ?? ""}" เป็นหลักพันตามสเกลของเกณฑ์`;
    return {
      ...rescaled,
      resultRaw: core.resultRaw,
      reason: rescaled.reason ? `${rescaled.reason} — ${note}` : note,
    };
  }

  const note =
    "ตัวเลขมี comma คั่น อ่านได้ 2 ทาง (1,500 = 1.5 หรือ 1500) — ระบบอ่านเป็นทศนิยม เทียบกับใบจริง";
  return {
    ...core,
    ambiguousThousands: true,
    needsReview: true,
    reason: core.reason ? `${core.reason} — ${note}` : note,
  };
}

// เลือกสเกลของค่าผลจาก magnitude ของขอบเกณฑ์ (ดู pickScale ใน numeric.ts)
//   คืน null = ตัดสินไม่ได้ (SKIP อยู่แล้ว / ไม่มีค่าเลขเดี่ยว / เกณฑ์ไม่มีขอบให้ยึด)
function pickThousandsReading(core: EvaluatedItem): "eu" | "us" | null {
  if (core.status === "SKIP") return null;
  const eu = core.result;
  if (eu == null || !Number.isFinite(eu) || eu === 0) return null;
  // ขอบเกณฑ์ 2 ข้างใช้ geometric mean · ตัด 0 ทิ้ง ("0~2" ต้องได้ 2 ไม่ใช่ 0) · ไม่เหลือขอบ = ไม่มีหลักให้ยึด
  const bounds = [core.min, core.max]
    .filter((v): v is number => v != null && Number.isFinite(v) && v !== 0)
    .map(Math.abs);
  if (bounds.length === 0) return null;
  const anchor = Math.sqrt(Math.min(...bounds) * Math.max(...bounds));
  return pickScale(Math.abs(eu), anchor);
}

// ข้อความ → กุญแจเทียบ (ตัดตัวพิมพ์/ช่องว่าง/เครื่องหมาย เก็บ latin+เลข+CJK) — สั้นกว่า 2 ตัว = เทียบไม่ได้
export function textKey(s: string | null): string {
  const k = (s ?? "").toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿]+/g, "");
  return k.length >= 2 ? k : "";
}

// ขอบเกณฑ์สำหรับโชว์บนจอ — spec แบบ ≤/≥/= เก็บเลขไว้ที่ spec.value ไม่ใช่ min/max
// ไม่เติมให้ จอขึ้น Max "—" ทั้งที่ใบเขียน "Max 1" (325-HK แถว Traces)
function specBounds(spec: ParsedSpec): { min: number | null; max: number | null } {
  switch (spec.op) {
    case "ge":
    case "gt":
      return { min: spec.value ?? null, max: null };
    case "le":
    case "lt":
      return { min: null, max: spec.value ?? null };
    case "eq":
      return { min: spec.value ?? null, max: spec.value ?? null };
    default:
      return { min: spec.min ?? null, max: spec.max ?? null };
  }
}

// Evaluate 1 row: parse spec + result → เทียบตาม op (between/le/ge/lt/gt/eq)
// spec อ่านไม่ออก → SKIP "spec not parseable", result ไม่ใช่ตัวเลข → SKIP "result not numeric"
function evaluateItemCore(item: CoaItemInput): EvaluatedItem {
  const name = (item.name ?? "").trim() || "(unknown)";
  const unit = item.unit?.toString().trim() || null;
  const method = item.method?.toString().trim() || null;

  const spec = normalizeSpecFromCandidate({
    specRaw: item.specRaw,
    min: item.specMin,
    max: item.specMax,
  });
  const result = normalizeResult(resolveResultInput(item));

  const base = {
    name,
    unit,
    method,
    specRaw: spec?.raw ?? (item.specRaw ?? null),
    resultRaw: result?.raw ?? (item.result == null ? null : String(item.result)),
    resultMin: null as number | null,
    resultMax: null as number | null,
  };

  if (!spec) {
    // ★ แถวข้อความล้วน (Appearance / 色相 / K2Ti6O13) ★ — ใบเขียนเกณฑ์กับผลเป็นคำเดียวกัน = ผ่านตามใบ
    //   ไม่ตรงกัน → SKIP ไม่ใช่ FAIL เพราะ OCR ตัดข้อความคนละท่อนได้จริง (เคส TSC APPEARANCE)
    const specText = textKey(base.specRaw);
    if (!result && specText && specText === textKey(base.resultRaw)) {
      return {
        ...base,
        min: null,
        max: null,
        result: null,
        status: "PASS",
        reason: `ข้อความตรงกับเกณฑ์บนใบ (${base.specRaw})`,
        needsReview: false,
      };
    }
    // ใบไม่ได้เขียนเกณฑ์ของแถวนี้ไว้เลย และค่าเป็นคำล้วนไม่มีตัวเลข (Appearance "good", Oil "nil")
    //   = หน้างานจดสภาพสินค้า ไม่ใช่ค่าวัด — ไม่มีอะไรให้เทียบ โชว์เป็นค่าอ่านอย่างเดียว
    const noSpecOnRow = !String(base.specRaw ?? "").trim();
    const wordResult = !!base.resultRaw && !/\d/.test(base.resultRaw);
    return {
      ...base,
      min: null,
      max: null,
      result: result?.value ?? null,
      status: "SKIP",
      reason:
        noSpecOnRow && wordResult
          ? `ใบไม่ได้กำหนดเกณฑ์ของรายการนี้ — บันทึกไว้ว่า "${base.resultRaw}"`
          : "อ่านเกณฑ์ (spec) เป็นตัวเลขไม่ได้ — ต้องอ่านจากใบเอง",
      needsReview: false,
      ...(noSpecOnRow && wordResult ? { infoOnly: true } : {}),
    };
  }

  if (!result) {
    const bounds = specBounds(spec);
    // ใบเขียนค่าผลเป็นคำ (Traces / N/A) ทั้งที่เกณฑ์เป็นตัวเลข — ระบบยืนยันว่าผ่านไม่ได้ = ไม่ผ่าน
    //   (user decision 2026-09-11) · ค่าผลว่างเปล่าคนละเรื่อง: ไม่มีอะไรให้ตัดสิน ยังเป็นต้องตรวจ
    const wordResult = !!String(base.resultRaw ?? "").trim();
    return {
      ...base,
      min: bounds.min,
      max: bounds.max,
      result: null,
      status: wordResult ? "FAIL" : "SKIP",
      reason: wordResult
        ? `ค่าผลบนใบเป็นข้อความ "${base.resultRaw}" เทียบกับเกณฑ์ ${spec.raw} ไม่ได้ — ระบบยืนยันว่าผ่านไม่ได้ ต้องอ่านจากใบ`
        : `ใบไม่มีค่าผลของรายการนี้ให้เทียบกับเกณฑ์ ${spec.raw} — ต้องอ่านจากใบ`,
      needsReview: wordResult,
    };
  }

  // ★ result แบบ bound (เช่น "<15", "≤0.01") ★ — ค่าด้านเดียว ไม่ใช่จุดเดียว
  //   PASS เฉพาะเมื่อทุกค่าในช่วง bound เข้า spec แน่ (พิสูจน์ได้ ไม่ deceptive) · ไม่งั้น SKIP (ตัดสินไม่ได้)
  //   ★ ห้าม FAIL จาก bound result — result เพี้ยน/ด้านเดียว ไม่ควรให้ verdict ของเสีย
  if (result.bound) {
    const verdict = evalBoundResult(result.bound, spec); // "PASS" | "SKIP"
    return {
      ...base,
      min: spec.min ?? (spec.op === "ge" || spec.op === "gt" ? spec.value ?? null : null),
      max: spec.max ?? (spec.op === "le" || spec.op === "lt" ? spec.value ?? null : null),
      result: null, // ไม่มีค่าเลขเดี่ยว — resultRaw เก็บข้อความ "<15" ไว้
      status: verdict,
      reason:
        verdict === "PASS"
          ? `bound result ${result.raw} satisfies spec ${spec.raw}`
          : `bound result ${result.raw} — cannot confirm against spec ${spec.raw} (indeterminate)`,
      needsReview: verdict === "SKIP",
    };
  }

  // ★ result เป็นช่วง (คอลัมน์ Results Min | Max — ไม่มีคอลัมน์ result เดี่ยว, เคส RB220) ★
  //   กติกา: ช่วงที่วัดได้ต้องอยู่ในกรอบ spec "ทั้งช่วง" — ขอบใดขอบหนึ่งหลุด = FAIL (ของจริงเกินเกณฑ์)
  //   ★ ห้ามยุบเป็นค่าเฉลี่ย ★ (result-normalizer) — avg ซ่อนขอบที่หลุดได้ = deceptive PASS
  if (result.interval) {
    return evaluateInterval(base, result.interval, spec);
  }

  const { value: r } = result;
  let pass = false;
  let min: number | null = null;
  let max: number | null = null;

  switch (spec.op) {
    case "between":
      min = spec.min!;
      max = spec.max!;
      pass = r >= min && r <= max;
      break;
    case "le":
      max = spec.value!;
      pass = r <= max;
      break;
    case "lt":
      max = spec.value!;
      pass = r < max;
      break;
    case "ge":
      min = spec.value!;
      pass = r >= min;
      break;
    case "gt":
      min = spec.value!;
      pass = r > min;
      break;
    case "eq":
      pass = r === spec.value;
      min = spec.value!;
      max = spec.value!;
      break;
    case "approx":
      pass = r === spec.value;
      break;
  }

  // ★ Anti-fabricated-PASS guard ★ — โมเดลเล็กเจอตาราง "Spec | Result" แยกคอลัมน์ บางทีเอาค่าผลไปแปะเป็นขอบ spec เอง
  //   (spec=80.0, result=69.11 → "69.11~80.0") → result ตกในช่วงตัวเองเสมอ = PASS ปลอม 100%
  //   สัญญาณ: result ตรงขอบเป๊ะ → downgrade เป็น SKIP ให้คนตรวจ (ปลอดภัยกับ FAIL จริงเพราะไม่มีทาง == ขอบ)
  const boundaryExact =
    spec.op === "between"
      ? r === spec.min || r === spec.max
      : (spec.op === "le" || spec.op === "ge") &&
        !spec.dirFromColumn &&
        r === spec.value;

  // เกณฑ์อ่านมาจากช่องของตัวเองบนใบ + ค่าผลเท่าเกณฑ์เป๊ะ = ผ่านทุกทิศที่เป็นไปได้ (≤/≥/=) → PASS ได้ แต่ยังปักธง
  //   เกณฑ์ที่ LLM คัดลอกค่าผลมาเองไม่เข้าเงื่อนไข (FC-250-1500 ไม่มีคอลัมน์เกณฑ์ → ต้อง SKIP ต่อ)
  const specCellEquality =
    item.specFromCell === true &&
    pass &&
    ((spec.op === "between" && spec.min === spec.max && r === spec.min) ||
      ((spec.op === "eq" || spec.op === "approx") && r === spec.value));

  if (pass && boundaryExact && !specCellEquality) {
    return {
      ...base,
      min,
      max,
      result: r,
      status: "SKIP",
      reason: "ค่าผลตรงขอบเกณฑ์พอดี — ระบบอาจอ่านเกณฑ์เพี้ยน เทียบกับใบจริง",
      needsReview: true,
    };
  }

  // ★ Anti-deceptive guard (bare-eq, symmetric) ★ — op=eq/approx = spec เป็นเลขเดี่ยวไม่มีทิศ (ไม่มี range/≤≥/Max Min)
  //   โมเดลเล็กอ่าน spec column ไม่ออกทำ 2 บาป: copy ค่าผลมาเป็น spec → PASS ลม, หรือหยิบ bound มาทิ้งทิศ → FAIL ลม
  //   ทิศไม่รู้ = verdict เชื่อไม่ได้ → SKIP+needsReview เสมอ (honest SKIP ดีกว่า confident wrong)
  if ((spec.op === "eq" || spec.op === "approx") && spec.value != null && !specCellEquality) {
    return {
      ...base,
      min,
      max,
      result: r,
      status: "SKIP",
      reason: pass
        ? "ระบบอาจอ่านค่าผลสลับมาเป็นเกณฑ์ (spec) — เทียบกับใบจริง"
        : "เกณฑ์เป็นเลขเดี่ยว ระบบไม่รู้ว่าเป็นค่าต่ำสุดหรือสูงสุด (ทิศหาย) — เทียบกับใบจริง",
      needsReview: true,
    };
  }

  // ใบพิมพ์เกณฑ์ที่ไม่มีค่าใดผ่านได้ ("<0.0" บนค่าที่ติดลบไม่ได้ — Kemolit KF-3 แถว Retention on 60 mesh)
  //   ความผิดอยู่บนใบ ไม่ใช่ของเสีย → SKIP ให้คนอ่านใบเอง ห้ามฟ้อง FAIL
  if (!pass && spec.op === "lt" && spec.value === 0 && r >= 0) {
    return {
      ...base,
      min,
      max,
      result: r,
      status: "SKIP",
      reason: `ใบพิมพ์เกณฑ์ ${spec.raw} — ไม่มีค่าใดผ่านได้ เทียบกับใบจริง`,
      needsReview: true,
    };
  }

  const review = detectDecimalRisk(r, spec, pass);
  const reason = pass
    ? review ?? ""
    : `result ${r} outside spec ${spec.raw}` + (review ? ` — ${review}` : "");

  return {
    ...base,
    min,
    max,
    result: r,
    status: pass ? "PASS" : "FAIL",
    reason,
    // ค่าผลเท่าเกณฑ์ที่อ่านจากช่องของตัวเองเป๊ะ → ผ่านทุกทิศที่เป็นไปได้ (≤/≥/=) ธงบอกอะไรไม่ได้ จึงไม่ปัก
    //   (VERMICULITE แถว total: ใบเขียน 100% ผลรวม 100 คือตัวเช็คยอดรวม ไม่ใช่เกณฑ์ที่ต้องตีความ)
    needsReview: !!review,
  };
}

// ★ result 2 คอลัมน์ (Results Min | Results Max) → object interval ให้ normalizeResult ★
//   ครบคู่ + อ่านเป็นเลขได้ทั้งคู่เท่านั้นถึงถือเป็นช่วง (ครบคู่ชนะ result เดี่ยว — ข้อมูลมากกว่า)
//   อ่านได้ขอบเดียว: ถ้ามี result เดี่ยวอยู่แล้วใช้ตัวนั้น ไม่งั้นใช้ขอบที่อ่านได้เป็นค่าเดี่ยว (พฤติกรรมเดิม)
function resolveResultInput(item: CoaItemInput): CoaItemInput["result"] {
  const lo = normalizeResult(item.resultMin ?? null);
  const hi = normalizeResult(item.resultMax ?? null);
  if (lo && hi) {
    return { min: lo.value, max: hi.value, raw: `${lo.raw} – ${hi.raw}` };
  }
  const single = item.result;
  if (single != null && String(single).trim() !== "") return single;
  const only = lo ?? hi;
  return only ? only.value : single ?? null;
}

type ItemBase = Pick<
  EvaluatedItem,
  "name" | "unit" | "method" | "specRaw" | "resultRaw" | "resultMin" | "resultMax"
>;

// ★ interval containment ★ — [rMin, rMax] ต้องอยู่ในกรอบ spec ทั้งช่วง (between/le/ge ตามทิศ) หลุดขอบใดขอบหนึ่ง → FAIL
//   (user decision: ค่าที่วัดได้จริงเกินเกณฑ์ = ของเสีย) · spec เลขเดี่ยวไม่มีทิศ → SKIP เหมือน path ค่าเดี่ยว
//   ผูก result ไว้ที่เลขเดี่ยว (binding) เพื่อให้ guard/margin/decimal-risk ที่คิดบนเลขเดี่ยวยังทำงานถูกทาง
function evaluateInterval(
  base: ItemBase,
  iv: { min: number; max: number },
  spec: ParsedSpec
): EvaluatedItem {
  const { min: rMin, max: rMax } = iv;
  const withIv = { ...base, resultMin: rMin, resultMax: rMax };

  if (spec.op === "eq" || spec.op === "approx") {
    return {
      ...withIv,
      min: spec.value ?? null,
      max: spec.value ?? null,
      result: null,
      status: "SKIP",
      reason:
        "เกณฑ์เป็นเลขเดี่ยว ระบบไม่รู้ว่าเป็นค่าต่ำสุดหรือสูงสุด (ทิศหาย) — เทียบกับใบจริง",
      needsReview: true,
    };
  }

  let min: number | null = null;
  let max: number | null = null;
  let pass = false;
  let binding = rMax;
  switch (spec.op) {
    case "between":
      min = spec.min!;
      max = spec.max!;
      pass = rMin >= min && rMax <= max;
      // ขอบที่ตัดสิน: ตัวที่หลุด (ถ้าหลุด) ไม่งั้นตัวที่ margin เหลือน้อยกว่า
      binding =
        rMax > max ? rMax : rMin < min ? rMin : max - rMax <= rMin - min ? rMax : rMin;
      break;
    case "le":
      max = spec.value!;
      pass = rMax <= max;
      break;
    case "lt":
      max = spec.value!;
      pass = rMax < max;
      break;
    case "ge":
      min = spec.value!;
      pass = rMin >= min;
      binding = rMin;
      break;
    case "gt":
      min = spec.value!;
      pass = rMin > min;
      binding = rMin;
      break;
  }

  // Anti-fabricated-PASS (เหมือน path ค่าเดี่ยว) — ช่วง result ที่ขอบตรงกับขอบ spec พอดี น่าสงสัยว่า
  //   ระบบอ่านคอลัมน์สลับ (เอาช่วง spec มาเป็น result) → honest SKIP ให้คนเทียบใบจริง

  // ขอบเดียว (≤/≥) นับด้วย — ไม่งั้น "0.10-0.28" vs "0.28 Max." เขียวสนิท ทั้งที่ค่าเดี่ยว 0.28 โดน SKIP
  const boundaryExact =
    spec.op === "between"
      ? rMin === min || rMax === max
      : (spec.op === "le" || spec.op === "ge") &&
        !spec.dirFromColumn &&
        (spec.op === "le" ? rMax : rMin) === spec.value;

  if (pass && boundaryExact) {
    return {
      ...withIv,
      min,
      max,
      result: binding,
      status: "SKIP",
      reason: "ค่าผลตรงขอบเกณฑ์พอดี — ระบบอาจอ่านเกณฑ์เพี้ยน เทียบกับใบจริง",
      needsReview: true,
    };
  }

  const review = detectDecimalRisk(binding, spec, pass);
  const range = `${fmtNum(rMin)}–${fmtNum(rMax)}`;
  return {
    ...withIv,
    min,
    max,
    result: binding,
    status: pass ? "PASS" : "FAIL",
    reason: pass
      ? review ??
        `ค่าที่วัดได้เป็นช่วง ${range} อยู่ในเกณฑ์ ${spec.raw} — ยืนยันคอลัมน์ Min/Max กับใบจริง`
      : `result ${range} outside spec ${spec.raw}` + (review ? ` — ${review}` : ""),
    // PASS: ทั้งช่วงอยู่ในกรอบ spec = ผ่าน ไม่ต้องตรวจซ้ำ (user decision 2026-08-03) · ธงเหลือไว้ให้
    //   detectDecimalRisk เท่านั้น. FAIL: ปล่อยโชว์ FAIL ตรง ๆ (อย่าซ่อนใต้ "ต้องตรวจ")
    needsReview: !!review,
  };
}

// bound result เทียบ spec — คืน PASS เฉพาะเมื่อทั้งช่วง bound อยู่ใน spec แน่นอน
// b = bound ของ result (lt/le/gt/ge X) · แยก logic ตามทิศ · spec between/eq → ตัดสินไม่ได้ (SKIP)
function evalBoundResult(
  b: { op: "lt" | "le" | "gt" | "ge"; value: number },
  spec: ParsedSpec
): "PASS" | "SKIP" {
  const X = b.value;
  const upper = b.op === "lt" || b.op === "le"; // result บอกว่า value ต่ำกว่า X
  if (upper) {
    // value < X (lt) หรือ <= X (le) — spec ต้องเป็น upper bound ด้วย
    if (spec.op === "le" && spec.value != null) {
      // ต้องให้ทุก v<=X (หรือ <X) ≤ Y  ⟺  X <= Y
      return X <= spec.value ? "PASS" : "SKIP";
    }
    if (spec.op === "lt" && spec.value != null) {
      // lt-result vs lt-spec: X<=Y ผ่าน · le-result vs lt-spec: ต้อง X<Y (X==Y → v==X==Y ไม่ < Y)
      const ok = b.op === "lt" ? X <= spec.value : X < spec.value;
      return ok ? "PASS" : "SKIP";
    }
    return "SKIP"; // spec แบบ ge/gt/between/eq → ตัดสินไม่ได้
  } else {
    // value > X (gt) หรือ >= X (ge) — spec ต้องเป็น lower bound ด้วย
    if (spec.op === "ge" && spec.value != null) {
      return X >= spec.value ? "PASS" : "SKIP";
    }
    if (spec.op === "gt" && spec.value != null) {
      const ok = b.op === "gt" ? X >= spec.value : X > spec.value;
      return ok ? "PASS" : "SKIP";
    }
    return "SKIP"; // spec แบบ le/lt/between/eq → ตัดสินไม่ได้
  }
}

// ตรวจความเสี่ยง "OCR ทศนิยมหาย" — ★ ไม่เปลี่ยน PASS/FAIL ★ แค่ตั้งธงให้คนตรวจใบจริง
//  - FAIL: ถ้าเติมทศนิยมแล้วเข้า spec (423→42.3 ใน 15-45) = น่าจะ OCR พลาด ไม่ใช่ของเสียจริง
function specContains(spec: ParsedSpec, v: number): boolean {
  switch (spec.op) {
    case "between":
      return v >= (spec.min ?? -Infinity) && v <= (spec.max ?? Infinity);
    case "le":
      return v <= (spec.value ?? Infinity);
    case "lt":
      return v < (spec.value ?? Infinity);
    case "ge":
      return v >= (spec.value ?? -Infinity);
    case "gt":
      return v > (spec.value ?? -Infinity);
    case "eq":
    case "approx":
      return v === spec.value;
    default:
      return false;
  }
}

function detectDecimalRisk(
  r: number,
  spec: ParsedSpec,
  pass: boolean
): string | null {
  if (!Number.isInteger(r) || r === 0) return null;
  const alts = [r / 10, r / 100];
  if (!pass) {
    for (const a of alts) {
      if (specContains(spec, a))
        return `อาจมีจุดทศนิยมหาย (เช่น ${r} จริง ๆ คือ ${a} แล้วเข้าเกณฑ์) — เทียบกับใบจริง`;
    }
    return null;
  }
  // ★ ฝั่ง PASS ไม่ปักธงแล้ว (user decision 2026-09-11) ★ — เกณฑ์ขั้นต่ำที่ค่าผลเป็นจำนวนเต็มติดธง
  //   แทบทุกแถว (84 กับเกณฑ์ ≥80 → เตือนว่าอาจเป็น 8.4) ทั้งที่ OCR อ่านถูก = ธงเฟ้อจนคนเลิกเชื่อธง
  return null;
}

export interface CoaInput {
  filename: string;
  product?: string | null;
  lotNo?: string | null;
  items: CoaItemInput[];
}

// debug: หลักฐานดิบของ run นี้ — เปิดดูใน coa-log JSON ได้ว่า "พังที่ model ไหน"
//   OCR (rapidocr/text-layer) อ่านมาเป็นอะไร vs LLM (ollama) parse ออกมาเป็นอะไร
//   เคส Lot240521: ocrText อ่าน "0.3 | 3 Max" ถูก แต่ llmRaw ได้ result 42 → ผิดที่ LLM ชัดเจน
export interface CoaDebug {
  ocrEngine: string; // "text-layer" | "rapidocr"
  ocrText: string; // ข้อความที่ป้อนเข้า LLM (หลัง OCR/text-layer)
  llmModel: string; // ollama model ที่ใช้ parse
  llmRaw: string | null; // JSON ดิบที่ LLM คายออกมา (ก่อน guard/normalize)
}

export interface CoaReport {
  filename: string;
  product: string | null;
  lotNo: string | null;
  page?: number; // เลขหน้า PDF เริ่มที่ 1 · single-page/image = 1
  rows: EvaluatedItem[];
  summary: { pass: number; fail: number; skip: number; total: number };
  // ใบนี้ไม่มีคอลัมน์เกณฑ์เลย (ดู suppressCopiedSpec) — ต้องเอา spec จากที่ตั้งไว้ในระบบมาเทียบเอง
  noSpecOnPaper?: boolean;
  debug?: CoaDebug; // optional — แนบเฉพาะตอนรันจริง (route/test-coa), unit test ไม่ต้องมี
}

// รวม summary จาก rows — แยกออกมาเพื่อให้ post-eval guard (fail-guard) เรียกซ้ำหลังแก้ status ได้
export function summarize(rows: EvaluatedItem[]): CoaReport["summary"] {
  return rows.reduce(
    (acc, r) => {
      acc.total++;
      if (r.status === "PASS") acc.pass++;
      else if (r.status === "FAIL") acc.fail++;
      else acc.skip++;
      return acc;
    },
    { pass: 0, fail: 0, skip: 0, total: 0 }
  );
}

// Evaluate ทั้งใบ — loop เรียก evaluateItem แล้วรวม summary
// ใบที่ไม่มีคอลัมน์เกณฑ์เลย (เช่น Imerys TIMREX) โมเดลจะ copy ค่าผลมาเป็น spec → เทียบตัวเองผ่านหมด
//   ตัดสินระดับใบ ไม่ใช่รายแถว — บางใบมีแถวที่ค่าตรงเกณฑ์พอดีโดยชอบธรรม (RI-015 Sb "<15")
function suppressCopiedSpec(rows: EvaluatedItem[]): { rows: EvaluatedItem[]; noSpecOnPaper: boolean } {
  const copied = (r: EvaluatedItem) =>
    !!r.specRaw && r.specRaw.replace(/\s/g, "") === r.resultRaw?.replace(/\s/g, "");
  const comparable = rows.filter((r) => r.specRaw && r.resultRaw);
  if (comparable.length < 3) return { rows, noSpecOnPaper: false };
  if (comparable.filter(copied).length / comparable.length < 0.6) return { rows, noSpecOnPaper: false };

  return {
    noSpecOnPaper: true,
    rows: rows.map((r) =>
      r.status === "PASS" && copied(r)
        ? {
            ...r,
            status: "SKIP" as Status,
            reason: "ใบนี้ไม่มีคอลัมน์เกณฑ์ — ระบบเอาค่าผลมาเทียบกับตัวเอง ต้องตั้ง spec เอง",
            needsReview: true,
          }
        : r
    ),
  };
}

export function evaluateCoa(input: CoaInput): CoaReport {
  const { rows, noSpecOnPaper } = suppressCopiedSpec((input.items ?? []).map(evaluateItem));
  const summary = summarize(rows);
  return {
    filename: input.filename,
    product: input.product?.trim() || null,
    lotNo: input.lotNo?.trim() || null,
    rows,
    summary,
    noSpecOnPaper,
  };
}

// Pretty-print แบบ ASCII table — ใช้กับ CLI (test-coa.ts) เท่านั้น (HTTP คืน JSON)
export function formatReport(report: CoaReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(110));
  lines.push(`FILE   : ${report.filename}`);
  if (report.product) lines.push(`PRODUCT: ${report.product}`);
  if (report.lotNo) lines.push(`LOT    : ${report.lotNo}`);
  lines.push("-".repeat(110));

  const header = [
    pad("Item", 36),
    pad("Min", 10),
    pad("Max", 10),
    pad("Result", 10),
    pad("Unit", 8),
    pad("Status", 6),
    "Note",
  ].join("  ");
  lines.push(header);
  lines.push("-".repeat(110));

  const checkRows = report.rows.filter((r) => !r.infoOnly);
  for (const r of checkRows) {
    lines.push(
      [
        pad(trunc(r.name, 36), 36),
        pad(fmtNum(r.min), 10),
        pad(fmtNum(r.max), 10),
        pad(fmtNum(r.result), 10),
        pad(trunc(r.unit ?? "", 8), 8),
        pad(r.status, 6),
        (r.needsReview ? "⚠ " : "") + r.reason,
      ].join("  ")
    );
  }
  lines.push("-".repeat(110));
  const n = countRows(report.rows);
  lines.push(`SUMMARY: ${n.pass} PASS, ${n.fail} FAIL, ${n.skip} SKIP (of ${n.total})`);

  // ค่าบนใบที่ไม่มีเกณฑ์ให้เทียบ — พิมพ์ไว้ให้อ่าน ไม่รวมในตารางผลและไม่นับใน SUMMARY
  const infoRows = report.rows.filter((r) => r.infoOnly && (r.result != null || r.resultRaw));
  if (infoRows.length > 0) {
    lines.push("");
    lines.push("ค่าบนใบที่ไม่มีเกณฑ์ (ดูอย่างเดียว ไม่นับเป็นรายการตรวจ):");
    lines.push(
      "  " +
        infoRows
          .map((r) => `${r.name} ${r.result != null ? fmtNum(r.result) : r.resultRaw}${r.unit ? " " + r.unit : ""}`)
          .join("  ·  ")
    );
  }
  return lines.join("\n");
}

// นับเฉพาะแถวที่ระบบตรวจจริง — แถว infoOnly ไม่มีเกณฑ์ให้เทียบ นับปนแล้ว SKIP บวมไม่ตรงกับที่คนต้องทำ
export function countRows(rows: { status: Status; infoOnly?: boolean }[]) {
  const counted = rows.filter((r) => !r.infoOnly);
  return {
    pass: counted.filter((r) => r.status === "PASS").length,
    fail: counted.filter((r) => r.status === "FAIL").length,
    skip: counted.filter((r) => r.status === "SKIP").length,
    total: counted.length,
  };
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}
function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}
