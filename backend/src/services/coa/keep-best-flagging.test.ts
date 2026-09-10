// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node keep-best-flagging.test.ts
import { CoaReport, EvaluatedItem, summarize } from "./coa-evaluator";
import { flagChallengerPasses } from "./coa-pipeline";

function row(
  name: string,
  result: number | null,
  min: number | null = null,
  max: number | null = null,
  specRaw: string | null = null
): EvaluatedItem {
  return {
    name,
    unit: null,
    method: null,
    min,
    max,
    result,
    status: "PASS",
    reason: "",
    specRaw: specRaw ?? (max != null ? `<=${max}` : min != null ? `>=${min}` : null),
    resultRaw: result == null ? null : String(result),
    needsReview: false,
  };
}

function rpt(rows: EvaluatedItem[]): CoaReport {
  return { filename: "t.pdf", product: null, lotNo: null, page: 1, rows, summary: summarize(rows) };
}

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. ชื่อตรง ค่าเปลี่ยน · spatial (OCR เดา column) → amber
{
  const inc = rpt([row("Moisture", 0.71, null, 2)]);
  const ch = rpt([row("Moisture", 0.95, null, 2), row("pH", 11.1, 10.5, 11.5)]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("เขียนทับ → รายงาน 1 แถว", f.overwritten.length, 1);
  check("เขียนทับ → amber", ch.rows[0].needsReview, true);
  check("แถวใหม่ spatial → amber", ch.rows[1].needsReview, true);
}

// 2. ชื่อตรง ค่าเปลี่ยน · structural (column เชื่อได้ + margin กว้าง) → ยังต้อง amber (ธงเหนียว)
//    ค่าชุดนี้ผ่าน margin-green ทุกด่าน (12.5 ห่าง max 50 = margin 3.0) → ถ้าธงไม่เหนียวจะถูกล้างเป็นเขียว
{
  const inc = rpt([row("Loss on Ignition", 12.8, null, 50)]);
  const ch = rpt([row("Loss on Ignition", 12.5, null, 50)]);
  const f = flagChallengerPasses(ch, inc, "text-layer", "structural");
  check("structural เขียนทับ → รายงาน", f.overwritten.length, 1);
  check("structural เขียนทับ → amber ไม่ถูก margin-green ล้าง", ch.rows[0].needsReview, true);
}

// 3. ชื่อตรง ค่าเท่าเดิม → ไม่ amber (incumbent ยืนยันแล้ว)
{
  const inc = rpt([row("Moisture", 0.71, null, 2)]);
  const ch = rpt([row("Moisture", 0.71, null, 2)]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("ค่าเท่าเดิม → ไม่มีเขียนทับ", f.overwritten.length, 0);
  check("ค่าเท่าเดิม → ไม่ amber", ch.rows[0].needsReview, false);
  check("ค่าเท่าเดิม → ไม่นับ surfaced", f.surfaced, 0);
}

// 4. แถวใหม่ · structural + ค่ามีขอบเกณฑ์ → เขียวได้ (พฤติกรรมเดิมต้องอยู่)
{
  const inc = rpt([row("Moisture", 0.71, null, 2)]);
  const ch = rpt([row("Moisture", 0.71, null, 2), row("Density", 0.34, 0.3, 0.45)]);
  const f = flagChallengerPasses(ch, inc, "text-layer", "structural");
  check("แถวใหม่ structural → clean-green", ch.rows[1].needsReview, false);
  check("นับ greenlit", f.greenlit, 1);
}

// 5. แถวใหม่ · structural แต่ไม่มีขอบเกณฑ์ให้เทียบ → amber
{
  const inc = rpt([row("Moisture", 0.71, null, 2)]);
  const ch = rpt([row("Moisture", 0.71, null, 2), row("Appearance", 1, null, null, "-")]);
  const f = flagChallengerPasses(ch, inc, "text-layer", "structural");
  check("แถวใหม่ไม่มีขอบ → amber", ch.rows[1].needsReview, true);
  check("นับ surfaced", f.surfaced, 1);
}

// 6. ★ เคสคมสุด ★ สองแถวสลับค่ากัน — preservesPasses นับว่า "PASS เดิมครบ" ทั้งคู่ ทั้งที่เลขผิดทั้งคู่
{
  const inc = rpt([row("SiO2", 41.7, 40, 45), row("Al2O3", 13.2, 10, 15)]);
  const ch = rpt([row("SiO2", 13.2, 10, 15), row("Al2O3", 41.7, 40, 45)]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("สลับค่า → รายงานทั้ง 2 แถว", f.overwritten.length, 2);
  check("สลับค่า → SiO2 amber", ch.rows[0].needsReview, true);
  check("สลับค่า → Al2O3 amber", ch.rows[1].needsReview, true);
}

// 7. incumbent อ่านชื่อผิด (KGP-H65: flat หยิบ unit "g/ml" มาเป็นชื่อ) แต่ค่า+เกณฑ์ตรง → ยืนยันแล้ว ไม่ amber
{
  const inc = rpt([row("g/ml", 0.34, 0.3, 0.45)]);
  const ch = rpt([row("嵩密度", 0.34, 0.3, 0.45)]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("ชื่อต่างแต่ค่าตรง → ไม่เขียนทับ", f.overwritten.length, 0);
  check("ชื่อต่างแต่ค่าตรง → ไม่ amber", ch.rows[0].needsReview, false);
}

// 8. ชื่อต่างเฉพาะ spacing/μ (v5 vs mobile) → นับเป็นแถวเดียวกัน ไม่ใช่แถวใหม่
{
  const inc = rpt([row("Residue on sieve (106 μ m)", 0.02, null, 0.1)]);
  const ch = rpt([row("Residue on sieve(106m)", 0.02, null, 0.1)]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("ชื่อสะกดต่าง ค่าตรง → ไม่ amber", ch.rows[0].needsReview, false);
  check("ไม่นับเป็นแถวใหม่", f.surfaced, 0);
}

// 9. spec string สะกดต่างแต่ขอบเกณฑ์เท่ากัน → ไม่ amber (verdict คิดจาก min/max ไม่ใช่ตัวหนังสือ)
//    เคสจริง Z99/Barimite: flat เขียน "0~0.2" grid เขียน "0.2 max" ค่าเดียวกัน = เคยปักธงเฟ้อ 16 แถว
{
  const inc = rpt([row("325_MESH", 0.1, 0, 0.2, "0~0.2")]);
  const ch = rpt([row("325_MESH", 0.1, 0, 0.2, "0.2 max")]);
  const f = flagChallengerPasses(ch, inc, "text-layer", "structural");
  check("specRaw ต่างแต่ขอบเท่ากัน → ไม่ amber", ch.rows[0].needsReview, false);
  check("specRaw ต่างแต่ขอบเท่ากัน → ไม่รายงาน", f.overwritten.length, 0);
}

// 9b. ขอบเกณฑ์เปลี่ยนจริง (อ่าน spec คนละคอลัมน์) → amber แม้ค่าผลเท่าเดิม
{
  const inc = rpt([row("Moisture", 0.71, null, 2)]);
  const ch = rpt([row("Moisture", 0.71, null, 0.8)]);
  const f = flagChallengerPasses(ch, inc, "text-layer", "structural");
  check("max เปลี่ยน → amber", ch.rows[0].needsReview, true);
  check("max เปลี่ยน → รายงาน", f.overwritten.length, 1);
}

// 10. แถว SKIP/FAIL ของ challenger ไม่ถูกแตะ (ด่านนี้ดูแค่ PASS)
{
  const inc = rpt([row("Moisture", 0.71, null, 2)]);
  const skipRow = { ...row("Colour", null), status: "SKIP" as const, reason: "ค่าผลไม่ใช่ตัวเลข" };
  const ch = rpt([row("Moisture", 0.71, null, 2), skipRow]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("SKIP ไม่ถูกปักธง", ch.rows[1].needsReview, false);
  check("ไม่นับ surfaced", f.surfaced, 0);
}

// 11. ตารางชื่อซ้ำ (RI-015 "Particle Size" ×4) — challenger เก็บค่าเดิมไว้ + เพิ่มแถวใหม่ชื่อเดียวกัน
//     ห้ามฟ้องว่า "เขียนทับ" (ค่าเดิมยังอยู่) · ลำดับแถวใน challenger ต้องไม่เปลี่ยนผล
{
  const mk = () => rpt([row("Particle Size", 0.1, null, 0.5)]);
  const chA = rpt([row("Particle Size", 0.4, null, 0.5), row("Particle Size", 0.1, null, 0.5)]);
  const fA = flagChallengerPasses(chA, mk(), "rapidocr", "spatial");
  check("ชื่อซ้ำ: ค่าเดิมยังอยู่ → ไม่ฟ้องเขียนทับ", fA.overwritten.length, 0);
  check("ชื่อซ้ำ: แถวค่าเดิม → ไม่ amber", chA.rows[1].needsReview, false);
  check("ชื่อซ้ำ: แถวใหม่ → amber", chA.rows[0].needsReview, true);
  const chB = rpt([row("Particle Size", 0.1, null, 0.5), row("Particle Size", 0.4, null, 0.5)]);
  const fB = flagChallengerPasses(chB, mk(), "rapidocr", "spatial");
  check("สลับลำดับแล้วผลเท่ากัน (surfaced)", fB.surfaced, fA.surfaced);
  check("สลับลำดับแล้วผลเท่ากัน (overwritten)", fB.overwritten.length, fA.overwritten.length);
}

// 12. ★ เคสที่ reviewer จับได้ ★ ค่าผลว่าง + เกณฑ์ซ้ำกันหลายแถว (RI-015 มี 3 แถวเกณฑ์ <15)
//     "≤15 + ค่าว่าง" ไม่ใช่ลายนิ้วมือ → ห้ามเอาไปยืนยันแถวใหม่ที่ชื่อไม่ตรงกับใคร
{
  const inc = rpt([row("Sb (ppm)", null, null, 15)]);
  const ch = rpt([row("Hg (ppm)", null, null, 15), row("Sb (ppm)", null, null, 15)]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("แถวใหม่ค่าว่าง → amber (ห้ามยืนยันด้วยเกณฑ์)", ch.rows[0].needsReview, true);
  check("แถวที่ incumbent ยืนยันแล้ว → ไม่ amber", ch.rows[1].needsReview, false);
}

// 13. เกณฑ์ซ้ำ 2 แถวในฝั่ง incumbent → triple ไม่ unique → ห้ามยืนยันแถวใหม่ข้ามชื่อ
{
  const inc = rpt([row("Fe2O3", 0.02, null, 0.1), row("TiO2", 0.02, null, 0.1)]);
  const ch = rpt([
    row("PbO", 0.02, null, 0.1),
    row("Fe2O3", 0.02, null, 0.1),
    row("TiO2", 0.02, null, 0.1),
  ]);
  const f = flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("triple ซ้ำ → แถวใหม่ amber", ch.rows[0].needsReview, true);
  check("triple ซ้ำ → แถวเดิมทั้งคู่ไม่ amber", [ch.rows[1].needsReview, ch.rows[2].needsReview], [false, false]);
}

// 14. ธงต้องบอกได้ว่าให้ไปดูอะไร — reason ไม่ว่าง และกรณีเขียนทับต้องติด valueDisputed ให้ด่านอื่นข้าม
{
  const inc = rpt([row("Moisture", 0.71, null, 2), row("pH", 11.1, 10.5, 11.5)]);
  const ch = rpt([row("Moisture", 0.95, null, 2), row("Density", 0.34, 0.3, 0.45)]);
  flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("เขียนทับ → valueDisputed", ch.rows[0].valueDisputed, true);
  check("เขียนทับ → reason บอกเลขทั้งสองฝั่ง", /0.71\|\|2 → 0.95\|\|2/.test(ch.rows[0].reason), true);
  check("แถวใหม่ → reason ไม่ว่าง", ch.rows[1].reason.length > 0, true);
  check("แถวใหม่ → ไม่ติด valueDisputed", ch.rows[1].valueDisputed, undefined);
}

// 15. reason เดิมต้องไม่ถูกทับ (แถว bound-result มีข้อความของ evaluator อยู่แล้ว)
{
  const inc = rpt([row("Moisture", 0.71, null, 2)]);
  const keep = { ...row("Sb (ppm)", null, null, 15), reason: "bound result <15 satisfies spec <15" };
  const ch = rpt([row("Moisture", 0.71, null, 2), keep]);
  flagChallengerPasses(ch, inc, "rapidocr", "spatial");
  check("reason เดิมยังอยู่", ch.rows[1].reason.startsWith("bound result <15"), true);
  check("ต่อท้ายด้วยเหตุผลใหม่", ch.rows[1].reason.includes("ยืนยันไม่ได้"), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
