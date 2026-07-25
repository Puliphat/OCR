// Deterministic evaluator — รับ JSON จาก LLM แล้วตัด PASS/FAIL/SKIP ต่อ row
// Logic ไม่พึ่ง LLM เลย เปลี่ยน rule ที่นี่ได้โดยไม่ต้อง re-run pipeline
import { ParsedSpec, normalizeSpecFromCandidate } from "./spec-normalizer";
import { normalizeResult, ResultValues } from "./result-normalizer";

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
}

// Evaluate 1 row: parse spec + result → เทียบตาม op (between/le/ge/lt/gt/eq)
// spec อ่านไม่ออก → SKIP "spec not parseable", result ไม่ใช่ตัวเลข → SKIP "result not numeric"
export function evaluateItem(item: CoaItemInput): EvaluatedItem {
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
    return {
      ...base,
      min: null,
      max: null,
      result: result?.value ?? null,
      status: "SKIP",
      reason: "อ่านเกณฑ์ (spec) เป็นตัวเลขไม่ได้ — ข้ามรายการนี้",
      needsReview: false,
    };
  }

  if (!result) {
    return {
      ...base,
      min: spec.min ?? null,
      max: spec.max ?? null,
      result: null,
      status: "SKIP",
      reason: "ค่าผลไม่ใช่ตัวเลข — ข้ามรายการนี้",
      needsReview: false,
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

  // ★ Anti-fabricated-PASS guard ★ — โมเดลเล็กบางตัว (เห็นใน qwen2.5) เวลาเจอตารางคอลัมน์แยก
  //   "Spec | Result" จะเอา "ค่าผล" ไปแปะเป็นขอบช่วง spec (เช่น spec=80.0, result=69.11 → "69.11~80.0")
  //   ทำให้ result ตกในช่วงของตัวเองเสมอ → PASS ปลอม 100% ซึ่งซ่อนของที่อาจ OOS = บาปหนักสุดของ QA
  // สัญญาณ: spec เป็น between แล้ว result ตรงกับขอบเป๊ะ → ดาวน์เกรดเป็น SKIP ให้คนตรวจ
  // ปลอดภัย: เคสนี้เป็น would-be-PASS เท่านั้น (FAIL จริง result อยู่นอกช่วง ไม่มีทาง == ขอบ) → ไม่ซ่อน FAIL
  if (pass && spec.op === "between" && (r === spec.min || r === spec.max)) {
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

  // ★ Anti-deceptive guard (bare-eq, symmetric) ★ — op=eq/approx = spec เป็น "เลขเดี่ยวไม่มีทิศ"
  //   (ไม่มี range / ≤≥ / Max Min). โมเดลเล็กที่อ่าน spec column ไม่ออกทำ 2 บาป:
  //     (ก) copy ค่าผลมาเป็น spec → r === value → PASS ลม (PR1950W_4064 ทุกแถว, SODA, 4A metadata)
  //     (ข) หยิบ bound เดียวมาทิ้งทิศ → r !== value → FAIL ลม (Barimite "0.20%"=Max จริง→PASS, "95%"=Min จริง→PASS)
  //   ทั้งคู่ "ทิศไม่รู้ = verdict เชื่อไม่ได้" → SKIP+needsReview (Priority #1: honest SKIP > confident wrong)
  //   ★ cost ★ bare-eq ที่ FAIL จริง (Barimite D50 Min 11.0/actual 10.414) ก็โดน SKIP ด้วย —
  //     กู้ทิศจาก flat text ไม่ได้ (lever-1 column-placeholder ลองแล้ว regress: column position เชื่อไม่ได้
  //     เมื่อ Min/Max header merge/ค่าตกผิด slot) → จะได้ auto-FAIL คืนต้องพึ่ง structural extractor (Docling)
  //   ปลอดภัยกับ test: fixture จริงเป็น range/bound หมด ไม่มี eq → ไม่ regress (evaluator.test ยัง 4P/0F)
  if ((spec.op === "eq" || spec.op === "approx") && spec.value != null) {
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

// ★ interval containment ★ — [rMin, rMax] ต้องอยู่ในกรอบ spec ทั้งช่วง
//   between: rMin ≥ specMin AND rMax ≤ specMax · le/lt: rMax ≤ (<) spec · ge/gt: rMin ≥ (>) spec
//   หลุดขอบใดขอบหนึ่ง → FAIL (user decision: "หลุดกรอบต้อง FAIL" — ค่าที่วัดได้จริงเกินเกณฑ์ = ของเสีย)
//   spec เลขเดี่ยวไม่มีทิศ (eq/approx) → SKIP เหมือน path ค่าเดี่ยว (ทิศหาย = verdict เชื่อไม่ได้)
//   result (เลขเดี่ยว) = "ขอบที่ตัดสิน" (binding) → guard/margin/decimal-risk ที่คิดบนเลขเดี่ยวยังทำงานถูกทาง
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
  if (pass && spec.op === "between" && (rMin === min || rMax === max)) {
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
    // PASS: ธง amber ไว้ก่อน (อ่านมาจาก 2 คอลัมน์ = โครงสร้างที่อนุมาน) — margin-green ใน pipeline
    //   จะเคลียร์ให้เองถ้าค่าห่างขอบพอและคอลัมน์เชื่อได้. FAIL: ปล่อยโชว์ FAIL ตรง ๆ (อย่าซ่อนใต้ "ต้องตรวจ")
    needsReview: pass ? true : !!review,
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
//  - PASS: ถ้า spec เป็น lower-bound (≥/Min) แล้วค่าจริงอาจตก (≥10 ได้ 13 แต่จริง 1.3) = ผ่านแบบอันตราย
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
  // pass: flag เฉพาะ spec แบบ lower-bound (กัน false alarm บนค่าที่ถูกต้องอยู่แล้ว เช่น 56 ใน 45-75)
  if (spec.op === "ge" || spec.op === "gt") {
    for (const a of alts) {
      if (!specContains(spec, a))
        return `ผ่านแบบเสี่ยง — ถ้าค่าจริงคือ ${a} (จุดทศนิยมหาย) จะไม่ผ่านเกณฑ์ — เทียบกับใบจริง`;
    }
  }
  return null;
}

export interface CoaInput {
  filename: string;
  product?: string | null;
  lotNo?: string | null;
  items: CoaItemInput[];
}

// debug: หลักฐานดิบของ run นี้ — เปิดดูใน coa-log JSON ได้ว่า "พังที่ model ไหน"
//   OCR (rapidocr/tesseract/text-layer) อ่านมาเป็นอะไร vs LLM (ollama) parse ออกมาเป็นอะไร
//   เคส Lot240521: ocrText อ่าน "0.3 | 3 Max" ถูก แต่ llmRaw ได้ result 42 → ผิดที่ LLM ชัดเจน
export interface CoaDebug {
  ocrEngine: string; // "text-layer" | "rapidocr" | "tesseract"
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
export function evaluateCoa(input: CoaInput): CoaReport {
  const rows = (input.items ?? []).map(evaluateItem);
  const summary = summarize(rows);
  return {
    filename: input.filename,
    product: input.product?.trim() || null,
    lotNo: input.lotNo?.trim() || null,
    rows,
    summary,
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

  for (const r of report.rows) {
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
  lines.push(
    `SUMMARY: ${report.summary.pass} PASS, ${report.summary.fail} FAIL, ${report.summary.skip} SKIP (of ${report.summary.total})`
  );
  return lines.join("\n");
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
