import { normalizeResult } from "./result-normalizer";
import { evaluateItem } from "./coa-evaluator";

let pass = 0, fail = 0;

function check(label: string, ok: boolean, extra?: string) {
  if (ok) { pass++; }
  else { fail++; console.log("FAIL", label, extra ?? ""); }
}

// ── Parsing tests ─────────────────────────────────────────────────────────────

{
  const r = normalizeResult("<15");
  check("<15 → bound lt 15",
    r !== null && r.bound?.op === "lt" && r.bound?.value === 15);
}
{
  const r = normalizeResult("≤0.01");
  check("≤0.01 → bound le 0.01",
    r !== null && r.bound?.op === "le" && Math.abs((r.bound?.value ?? NaN) - 0.01) < 1e-9);
}
{
  const r = normalizeResult("≦ 0.2");
  check("≦ 0.2 → bound le 0.2",
    r !== null && r.bound?.op === "le" && Math.abs((r.bound?.value ?? NaN) - 0.2) < 1e-9);
}
{
  const r = normalizeResult(">50");
  check(">50 → bound gt 50",
    r !== null && r.bound?.op === "gt" && r.bound?.value === 50);
}
{
  const r = normalizeResult("≥ 95");
  check("≥ 95 → bound ge 95",
    r !== null && r.bound?.op === "ge" && r.bound?.value === 95);
}
{
  const r = normalizeResult("388");
  check("388 → no bound, value 388",
    r !== null && r.bound === undefined && r.value === 388);
}
{
  const r = normalizeResult("White");
  check("White → null", r === null);
}
{
  const r = normalizeResult("1.09");
  check("1.09 → no bound, value 1.09",
    r !== null && r.bound === undefined && Math.abs(r.value - 1.09) < 1e-9);
}

// ── Evaluation tests ──────────────────────────────────────────────────────────

{
  const e = evaluateItem({ result: "<15", specRaw: "≤15" });
  check('result "<15", spec "≤15" → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "15 Max." });
  check('result "<15", spec "15 Max." → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "≤10" });
  check('result "<15", spec "≤10" → SKIP', e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<0.20", specRaw: "0.5 Max." });
  check('result "<0.20", spec "0.5 Max." → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: ">95", specRaw: "≥ 90" });
  check('result ">95", spec "≥ 90" → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: ">95", specRaw: "≥ 99" });
  check('result ">95", spec "≥ 99" → SKIP', e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "10-20" });
  check('result "<15", spec "10-20" (between) → SKIP', e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "<15", specRaw: "≥ 5" });
  check('result "<15", spec "≥ 5" (opposite direction) → SKIP (must NOT be FAIL)',
    e.status === "SKIP",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "387", specRaw: "275-425" });
  check('result "387", spec "275-425" → PASS (numeric control)', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}

// ── ห้ามเฉลี่ยเลขในข้อความ (ROUND 36) ─────────────────────────────────────────
// ค่ากลางของช่วง/ค่าเผื่อ ซ่อนขอบที่หลุดเกณฑ์ = deceptive PASS · เหตุผลเดียวกับ path object
{
  const r = normalizeResult("12.3 ± 0.2");
  check('"12.3 ± 0.2" → ช่วง 12.1–12.5 (ไม่ใช่ค่ากลาง 12.3 และไม่ใช่ค่าเฉลี่ย 6.25)',
    r?.source === "interval" && Math.abs((r?.interval?.min ?? NaN) - 12.1) < 1e-9 &&
    Math.abs((r?.interval?.max ?? NaN) - 12.5) < 1e-9, `got ${JSON.stringify(r)}`);
}
{
  const r = normalizeResult("12.3 +/- 0.2");
  check('"12.3 +/- 0.2" → ช่วงเดียวกัน', r?.source === "interval", `got ${JSON.stringify(r)}`);
}
{
  const e = evaluateItem({ result: "12.3 ± 0.2", specRaw: "5~10" });
  check('result "12.3 ± 0.2" spec "5~10" → FAIL (เดิมเฉลี่ยเป็น 6.25 แล้ว PASS เงียบ)',
    e.status === "FAIL", `got ${e.status}: ${e.reason}`);
}
// ★ LLM หยิบช่องเกณฑ์มาวางเป็นค่าผล ★ ค่ากลางอยู่กลางเกณฑ์ตัวเองเสมอ → เคยเขียวสนิท ต้องเป็น SKIP
{
  const e = evaluateItem({ result: "26 ± 2", specRaw: "26 ± 2" });
  check('result "26 ± 2" = spec "26 ± 2" → SKIP+ธง (ไม่ใช่ PASS จากเลขของเกณฑ์เอง)',
    e.status === "SKIP" && e.needsReview, `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "26 ± 2", specRaw: "24-28" });
  check('result "26 ± 2" spec "24-28" (ขอบตรงกันพอดี) → SKIP+ธง',
    e.status === "SKIP" && e.needsReview, `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "24.5 ± 0.5", specRaw: "24-28" });
  check('ช่วง 24–25 อยู่ในเกณฑ์ 24-28 แต่ขอบล่างตรงพอดี → SKIP+ธง',
    e.status === "SKIP" && e.needsReview, `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "25 ± 0.5", specRaw: "24-28" });
  check('ช่วง 24.5–25.5 ไม่ชนขอบเกณฑ์เลย → PASS',
    e.status === "PASS", `got ${e.status}: ${e.reason}`);
}
// ★ ขอบเดียว (≤/≥) ต้องปักธงเหมือน path ค่าเดี่ยว ★ acc8e0a: "ค่าผลตรงขอบพอดี" = อาจอ่านเกณฑ์มาเป็นค่าผล
{
  const e = evaluateItem({ result: "0.10-0.28", specRaw: "0.28 Max." });
  check('ช่วง 0.10–0.28 vs "0.28 Max." (ขอบบนตรงพอดี) → SKIP+ธง ไม่ใช่ PASS เขียว',
    e.status === "SKIP" && e.needsReview, `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "95.5-99.0", specRaw: "Min. 95.5" });
  check('ช่วง 95.5–99.0 vs "Min. 95.5" (ขอบล่างตรงพอดี) → SKIP+ธง',
    e.status === "SKIP" && e.needsReview, `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "0.10-0.20", specRaw: "0.28 Max." });
  check('ช่วง 0.10–0.20 vs "0.28 Max." ไม่ชนขอบ → PASS ตามเดิม',
    e.status === "PASS", `got ${e.status}: ${e.reason}`);
}
// เครื่องหมายลบของเลขตัวหลังต้องไม่โดนตัวคั่นกิน (regex โลภ)
{
  const r = normalizeResult("-0.2--0.5");
  check('"-0.2--0.5" → ช่วง -0.5 ถึง -0.2 (ไม่ใช่ -0.2 ถึง 0.5)',
    r?.interval?.min === -0.5 && r?.interval?.max === -0.2, `got ${JSON.stringify(r)}`);
}
{
  const r = normalizeResult("-5 - 5");
  check('"-5 - 5" → ช่วง -5 ถึง 5', r?.interval?.min === -5 && r?.interval?.max === 5,
    `got ${JSON.stringify(r)}`);
}
// ★ "8.00-11.00" คือช่วง ไม่ใช่ 8 กับ -11 ★ ไล่เก็บเลขทีละตัวจะได้ค่าเฉลี่ย -1.5 = FAIL ปลอม (ZP10 ของจริง)
{
  const r = normalizeResult("8.00-11.00");
  check('"8.00-11.00" → ช่วง 8–11 (ไม่ใช่ -1.5)',
    r?.source === "interval" && r?.interval?.min === 8 && r?.interval?.max === 11,
    `got ${JSON.stringify(r)}`);
}
{
  const r = normalizeResult("30〜55 sec");
  check('"30〜55 sec" → ช่วง 30–55 (ตัวคั่นเต็มความกว้าง + หน่วยต่อท้าย)',
    r?.source === "interval" && r?.interval?.min === 30 && r?.interval?.max === 55,
    `got ${JSON.stringify(r)}`);
}
{
  const r = normalizeResult("0,07 – 0,28");
  check('"0,07 – 0,28" → ช่วง 0.07–0.28 (ทศนิยมแบบ EU + en dash)',
    r?.source === "interval" && Math.abs((r?.interval?.min ?? NaN) - 0.07) < 1e-9,
    `got ${JSON.stringify(r)}`);
}
{
  const e = evaluateItem({ result: "11.0～16.0", specRaw: "0~20" });
  check('ช่วง 11–16 อยู่ในเกณฑ์ 0~20 ทั้งช่วง → PASS', e.status === "PASS",
    `got ${e.status}: ${e.reason}`);
}
{
  const e = evaluateItem({ result: "11.0～16.0", specRaw: "0~15" });
  check('ช่วง 11–16 ขอบบนหลุด 0~15 → FAIL (ค่าเฉลี่ย 13.5 เคยซ่อนไว้)',
    e.status === "FAIL", `got ${e.status}: ${e.reason}`);
}
// เลขหลายตัวที่ไม่ใช่ช่วงและไม่ใช่ค่าเผื่อ = อ่านไม่ออกจริง → SKIP ดีกว่าปั้นค่าเฉลี่ย
{
  check('"1. 09" (OCR ตัดทศนิยม) → null', normalizeResult("1. 09") === null);
  check('"1.2 | 0.26" (สองช่องติดกัน) → null', normalizeResult("1.2 | 0.26") === null);
  check('"2.5 (n=3)" (มีหมายเหตุในวงเล็บ) → null', normalizeResult("2.5 (n=3)") === null);
}
// เลขเดี่ยวที่มีตัวคั่นหลักพัน/หน่วย ต้องไม่โดนกฎใหม่กิน
{
  check('"1,494.80" ยังเป็นเลขเดี่ยว', normalizeResult("1,494.80")?.value === 1494.8);
  check('"98.5 %" ยังเป็นเลขเดี่ยว', normalizeResult("98.5 %")?.value === 98.5);
  check('"-1.5" ยังเป็นเลขติดลบเดี่ยว', normalizeResult("-1.5")?.value === -1.5);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
