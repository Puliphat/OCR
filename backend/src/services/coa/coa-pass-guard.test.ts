// Print-based regression test — รัน: npx ts-node src/services/coa/coa-pass-guard.test.ts
// ยืนยัน: downgradeUngroundedPasses ดาวน์เกรด PASS ที่ spec/result ไม่อยู่ "บรรทัดชื่อ row" ใน OCR
//   (column collapse ฝั่ง PASS = false PASS) เป็น SKIP แต่คง PASS จริงไว้ + ไม่แตะ FAIL/SKIP
import { downgradeUngroundedPasses, PASS_DOWNGRADE_REASON } from "./coa-grounding";
import { EvaluatedItem } from "./coa-evaluator";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
}

function row(p: Partial<EvaluatedItem>): EvaluatedItem {
  return {
    name: "X",
    unit: null,
    method: null,
    min: null,
    max: null,
    result: null,
    status: "PASS",
    reason: "",
    specRaw: null,
    resultRaw: null,
    needsReview: false,
    ...p,
  };
}

// ★ เคสจริง Lot240521 (RapidOCR อ่านถูก, qwen scramble) ★ — ทุกแถวบรรทัดเดียว: ชื่อ | ค่า… | Average | spec | Success
const LOT_OCR = [
  "Sieve Residue on 500 μ(%)  |  0.3  |  3 Max.  |  Success",
  "SieveResidueon350ur%)  |  42  |  41  |  42.3  |  15 ~45  |  Suncess",
  "SicveResidueQn 150ur%)  |  54  |  56  |  58  |  56.0  |  45 ~T5  |  Success",
  "Sieve Residue under 150p(%)  |  1.3  |  20 Max  |  Success",
  "Bulk Deusityke/L)  |  330  |  322  |  335  |  329.0  |  270 -~350  |  Success",
].join("\n");

// item1 buggy: LLM ดึง 42/45 ข้ามจากแถว 350μ → result 42 / max 45 (จริง 0.3 / ≤3)
//   42 กับ 45 ดัน co-locate "บรรทัด 350μ" แต่ไม่อยู่ "บรรทัดชื่อ 500μ" → ต้อง downgrade
const buggy1 = [
  row({
    name: "Sieve Residue on 500 μ(%)",
    specRaw: "3 Max. 42 ~45 Success",
    max: 45,
    result: 42,
    resultRaw: "42",
  }),
];
const rBuggy1 = downgradeUngroundedPasses(buggy1, LOT_OCR);
check(
  "Lot240521 item1: result/spec ยกข้ามแถว (อยู่บรรทัด 350μ ไม่ใช่ 500μ) → downgrade PASS→SKIP",
  rBuggy1.downgraded.length === 1 && buggy1[0].status === "SKIP" && buggy1[0].needsReview,
  `(downgraded=${rBuggy1.downgraded.length})`
);
check("Lot240521 item1: reason = deceptive-PASS", buggy1[0].reason === PASS_DOWNGRADE_REASON);

// ★ KEY: ความบังเอิญ co-locate บนบรรทัดอื่น ต้องไม่ช่วยให้รอด ★ (เหตุผลที่ต้อง name-anchored)
//   42 & 45 มีจริงในบรรทัด 350μ — ถ้าเช็คแบบ any-line จะปล่อยผ่าน → false PASS รอด
check(
  "name-anchored: 42/45 บังเอิญอยู่บรรทัด 350μ ก็ช่วยไม่ได้ (ไม่ใช่บรรทัดชื่อ 500μ)",
  buggy1[0].status === "SKIP"
);

// item1 ถ้า extract ถูก: result 0.3 / spec ≤3 → อยู่บรรทัดชื่อ 500μ จริง → คง PASS
const correct1 = [
  row({ name: "Sieve Residue on 500 μ(%)", specRaw: "3 Max", max: 3, result: 0.3, resultRaw: "0.3" }),
];
const rCorrect1 = downgradeUngroundedPasses(correct1, LOT_OCR);
check(
  "Lot240521 item1 (extract ถูก 0.3/≤3): co-locate บรรทัดชื่อ → คง PASS",
  rCorrect1.downgraded.length === 0 && correct1[0].status === "PASS"
);

// item5 Bulk Density: result 335 (เป็นค่าวัดจริงในบรรทัดตัวเอง, ไม่ใช่ avg 329) + spec 270~350
//   335/270/350 อยู่บรรทัดชื่อ Bulk จริง → คง PASS (verdict ไม่ปลอม แม้เลขไม่ใช่ avg = เรื่องของ prompt ไม่ใช่ guard)
const bulk5 = [
  row({ name: "Bulk Deusityke/L)", specRaw: "270~350", min: 270, max: 350, result: 335, resultRaw: "335" }),
];
const rBulk5 = downgradeUngroundedPasses(bulk5, LOT_OCR);
check(
  "Lot240521 item5: 335/270/350 อยู่บรรทัดชื่อตัวเอง → คง PASS",
  rBulk5.downgraded.length === 0 && bulk5[0].status === "PASS"
);

// ★ glue-name regression (เคสจริง Lot240521 350μ) ★ — OCR อ่านชื่อแถวติดกัน "SieveResidueon350ur%)"
//   result 42.3 ∈ 15~45 = PASS จริง. แถวจริง (บรรทัด 2) มี 42.3 + 15~45 co-located ครบ แต่ชื่อติดกัน
//   → token-anchor พลาด ไป anchor บรรทัด 500μ (แชร์ "sieve residue on") → เคย downgrade ผิด.
//   glue-match ชี้บรรทัดจริง (ชื่อเต็มเป็น substring) → คง PASS
const glue350 = [
  row({ name: "Sieve Residue on 350ur%)", specRaw: "15 ~45", min: 15, max: 45, result: 42.3, resultRaw: "42.3" }),
];
const rGlue = downgradeUngroundedPasses(glue350, LOT_OCR);
check(
  "glue-name 350μ (ชื่อ OCR ติดกัน) result/spec อยู่บรรทัดจริง → คง PASS (glue-anchor)",
  rGlue.downgraded.length === 0 && glue350[0].status === "PASS",
  `(downgraded=${rGlue.downgraded.length})`
);

// ★ glue exact-cell (Opus review HIGH) ★ — glue ต้อง match "ทั้ง cell" ไม่ใช่ substring ที่ไหนก็ได้
//   ของจริง 500u = 0.3/≤3 (บรรทัด true). LLM ยก 42/45 จากแถวอื่น (deceptive). มี foreign blob line
//   ที่ชื่อโผล่เป็น "substring" (xx_sieveresidueon500u_blob) + แบก 42/45 → ถ้า glue ใช้ substring จะ
//   ยก foreign line เข้า anchor set แล้ว validate ค่ายืม = PASS ปลอมรอด. exact-cell → foreign blob
//   ไม่ match (cell = "xxsieveresidueon500ublob" ≠ "sieveresidueon500u") → anchor บรรทัดจริง → downgrade
const GLUE_DECEPTIVE_OCR = [
  "Sieve Residue on 500u  |  0.3  |  3 Max.  |  Success",
  "xx_sieveresidueon500u_blob  42  45 Max  borrowed",
].join("\n");
const glueDeceptive = [
  row({ name: "Sieve Residue on 500u", specRaw: "45 Max", max: 45, result: 42, resultRaw: "42" }),
];
const rGlueDec = downgradeUngroundedPasses(glueDeceptive, GLUE_DECEPTIVE_OCR);
check(
  "glue exact-cell: foreign blob (ชื่อเป็น substring) ยกค่ายืม → ยัง downgrade PASS→SKIP (HIGH fixed)",
  rGlueDec.downgraded.length === 1 && glueDeceptive[0].status === "SKIP",
  `(downgraded=${rGlueDec.downgraded.length})`
);

// ★ REGRESSION (Lot240521 150μ) ★ — OCR garble ชื่อ "SicveResidueQn 150ur%)" → token-anchor latch บรรทัด
//   500μ ผิด → false SKIP. aperture 150 ตัดบรรทัด 500μ ออก → คง PASS (result 56 ∈ 45~75 ของแถวจริง)
const garble150 = [
  row({ name: "Sieve Residue on 150ur%)", specRaw: "45 ~75", min: 45, max: 75, result: 56, resultRaw: "56" }),
];
const rGarble = downgradeUngroundedPasses(garble150, LOT_OCR);
check(
  "garble-name 150μ (OCR เพี้ยน Sicve/Qn) result 56 ของแถวจริง → คง PASS (aperture-anchor)",
  rGarble.downgraded.length === 0 && garble150[0].status === "PASS",
  `(downgraded=${rGarble.downgraded.length})`
);

// ★ qwen review #1 (aperture garble ทุกบรรทัด ห้ามถอยเกินเดิม) ★ — deceptive PASS: result 4 ยืมจากแถว
//   coating, ค่าจริงบรรทัด filter = 8. OCR garble เลข aperture 200 หายหมด (ไม่มีบรรทัดไหนมี 200).
//   ถ้า exclusion zero ทุกบรรทัด → backoff → keep deceptive PASS (อันตราย). apertureOnSomeLine=false →
//   fall back scoring เดิม → anchor บรรทัด filter (overlap 2) → result 4 ไม่อยู่ → downgrade ถูกต้อง
const APERTURE_GONE_OCR = [
  "Filter mesh size  |  8  |  5 Max  |  Pass",
  "Coating weight  |  4  |  20 Max  |  Pass",
].join("\n");
const apertureGone = [
  row({ name: "Filter mesh 200", specRaw: "5 Max", max: 5, result: 4, resultRaw: "4" }),
];
const rApGone = downgradeUngroundedPasses(apertureGone, APERTURE_GONE_OCR);
check(
  "aperture garble หายทุกบรรทัด → fall back scoring → ยัง downgrade deceptive PASS (qwen #1 safe)",
  rApGone.downgraded.length === 1 && apertureGone[0].status === "SKIP",
  `(downgraded=${rApGone.downgraded.length})`
);

// ★ ตารางปกติ name|spec|result บรรทัดเดียว → คง PASS ★
const CLEAN_OCR = "Moisture Content (%)  |  0.5 Max  |  0.2";
const clean = [
  row({ name: "Moisture Content (%)", specRaw: "0.5 Max", max: 0.5, result: 0.2, resultRaw: "0.2" }),
];
const rClean = downgradeUngroundedPasses(clean, CLEAN_OCR);
check(
  "ตารางปกติ spec+result บรรทัดชื่อเดียวกัน → คง PASS",
  rClean.downgraded.length === 0 && clean[0].status === "PASS"
);

// ★ ไม่แตะ FAIL / SKIP ★ — แม้ไม่ co-locate
const others = [
  row({ name: "Sieve Residue on 500 μ(%)", status: "FAIL", specRaw: "3 Max", max: 3, result: 99, resultRaw: "99" }),
  row({ name: "Sieve Residue on 500 μ(%)", status: "SKIP", specRaw: "3 Max", result: null }),
];
const rOther = downgradeUngroundedPasses(others, LOT_OCR);
check(
  "FAIL/SKIP ไม่ถูกแตะ (guard แตะเฉพาะ PASS)",
  rOther.downgraded.length === 0 && others[0].status === "FAIL" && others[1].status === "SKIP"
);

// ★ ชื่อสั้น (<2 token) → anchor ไม่ได้ → ปล่อย PASS (conservative, กัน false SKIP) ★
const shortName = [row({ name: "Ash", specRaw: "3 Max", max: 3, result: 99, resultRaw: "99" })];
const rShort = downgradeUngroundedPasses(shortName, LOT_OCR);
check("ชื่อสั้น 1 token → ไม่แตะ (ปล่อย PASS)", rShort.downgraded.length === 0 && shortName[0].status === "PASS");

// ★ ชื่อไม่อยู่ใน OCR เลย → anchor ไม่เจอ → ปล่อย PASS (พิสูจน์ collapse ไม่ได้) ★
const noAnchor = [row({ name: "Tin Content", specRaw: "5 Max", max: 5, result: 4, resultRaw: "4" })];
const rNo = downgradeUngroundedPasses(noAnchor, LOT_OCR);
check("ชื่อไม่อยู่ใน OCR → anchor ไม่เจอ → ปล่อย PASS", rNo.downgraded.length === 0 && noAnchor[0].status === "PASS");

// OCR ว่าง → ไม่ downgrade
const empty = [row({ name: "Sieve Residue on 500 μ(%)", specRaw: "3 Max", max: 45, result: 42, resultRaw: "42" })];
const rEmpty = downgradeUngroundedPasses(empty, "");
check("OCR ว่าง → ไม่ downgrade", rEmpty.downgraded.length === 0 && empty[0].status === "PASS");

// mixed: item1 buggy (downgrade) + item5 ok (คง) ในใบเดียว
const mixed = [
  row({ name: "Sieve Residue on 500 μ(%)", specRaw: "3 Max. 42 ~45", max: 45, result: 42, resultRaw: "42" }),
  row({ name: "Bulk Deusityke/L)", specRaw: "270~350", min: 270, max: 350, result: 335, resultRaw: "335" }),
];
const rMixed = downgradeUngroundedPasses(mixed, LOT_OCR);
check(
  "mixed: downgrade item1(collapse) คง item5(ok)",
  rMixed.downgraded.length === 1 && mixed[0].status === "SKIP" && mixed[1].status === "PASS",
  `(downgraded=${rMixed.downgraded.map((d) => d.name).join("/")})`
);

// ════ regression: เคส false-downgrade ที่เคยเจอใน corpus (ต้องคง PASS) ════

// ★ bug1: ± spec ★ — "Viscosity (cP/23°C) | 7 ± 3 | 6.6" normalize เป็น min4/max10 (คำนวณขึ้น ไม่มีใน OCR)
//   guard เก่าเอา 4/10 ไปบังคับ co-locate → downgrade ผิด. result 6.6 อยู่บรรทัดชื่อจริง → ต้องคง PASS
const PM_OCR = "Viscosity (cP/23°C)  |  7 ± 3  |  6.6\nSolid Content (%)  |  26.0 ± 2.0  |  27.06";
const pmRows = [
  row({ name: "Viscosity (cP/23°C)", specRaw: "7 ± 3", min: 4, max: 10, result: 6.6, resultRaw: "6.6" }),
  row({ name: "Solid Content (%)", specRaw: "26.0 ± 2.0", min: 24, max: 28, result: 27.06, resultRaw: "27.06" }),
];
const rPm = downgradeUngroundedPasses(pmRows, PM_OCR);
check(
  "± spec (min/max คำนวณ ไม่อยู่ OCR) result อยู่บรรทัดชื่อ → คง PASS (bug1 fixed)",
  rPm.downgraded.length === 0 && pmRows.every((r) => r.status === "PASS"),
  `(downgraded=${rPm.downgraded.length})`
);

// ★ bug2: ชื่อ wrap ข้ามบรรทัด ★ — "Canadian Standard" จริงคือ "Canadian Standard Freeness" ตัด 2 บรรทัด
//   บรรทัดชื่อไม่มี data number → ค่าจริงอยู่บรรทัด continuation → ต้องคง PASS (ไม่ใช่ collapse)
const WRAP_OCR = "Canadian Standard\nFreeness  |  350-650  |  388\npH  |  7.0~9.0  |  7.7\n(Aqueous Solution)";
const wrapRows = [
  row({ name: "Canadian Standard", specRaw: "350-650", min: 350, max: 650, result: 388, resultRaw: "388" }),
  row({ name: "pH (Aqueous Solution)", specRaw: "7.0~9.0", min: 7, max: 9, result: 7.7, resultRaw: "7.7" }),
];
const rWrap = downgradeUngroundedPasses(wrapRows, WRAP_OCR);
check(
  "ชื่อ wrap (บรรทัดชื่อไม่มี data number) → คง PASS (bug2 fixed)",
  rWrap.downgraded.length === 0 && wrapRows.every((r) => r.status === "PASS"),
  `(downgraded=${rWrap.downgraded.map((d) => d.name).join("/")})`
);

// ★ ชื่อมีแต่เลขฝังในชื่อ (106μm) ไม่มี data inline → คง PASS (ค่าอยู่บรรทัดต่อ) ★
const SIZE_OCR = "Residue on sieve(106μm)\n0.01\nResidue on sieve(500μm)  |  0.02";
const sizeRow = [row({ name: "Residue on sieve(106μm)", specRaw: "≤5.0", max: 5, result: 0.01, resultRaw: "0.01" })];
const rSize = downgradeUngroundedPasses(sizeRow, SIZE_OCR);
check(
  "เลขในชื่อ (106) ไม่นับ data number → บรรทัดชื่อไม่มี data → คง PASS",
  rSize.downgraded.length === 0 && sizeRow[0].status === "PASS"
);

// ★ HIGH (Opus review): borrowed-spec PASS ปลอม ★ — result ถูก แต่ LLM ยืม bound หลวมจากแถวอื่น
//   Iron จริง spec "10 Max" (12 > 10 = FAIL) แต่ LLM ได้ "50 Max" จากแถว Lead → 12 ≤ 50 = PASS ปลอม
//   bound 50 ไม่อยู่บรรทัด Iron (มี 12,10) → single-bound spec check จับได้ → downgrade
const BORROW_SPEC_OCR = "Iron Content (ppm)  |  12  |  10 Max  |  Pass\nLead Content (ppm)  |  3  |  50 Max  |  Pass";
const borrowSpec = [
  row({ name: "Iron Content (ppm)", specRaw: "50 Max", max: 50, result: 12, resultRaw: "12" }),
];
const rBorrow = downgradeUngroundedPasses(borrowSpec, BORROW_SPEC_OCR);
check(
  "borrowed-spec: result 12 อยู่บรรทัด แต่ bound 50 ยืมจากแถวอื่น → downgrade (HIGH fixed)",
  rBorrow.downgraded.length === 1 && borrowSpec[0].status === "SKIP",
  `(downgraded=${rBorrow.downgraded.length})`
);

// single-bound spec ที่ bound อยู่บรรทัดจริง → คง PASS (ไม่ over-fire)
const goodBound = [
  row({ name: "Iron Content (ppm)", specRaw: "10 Max", max: 10, result: 8, resultRaw: "8" }),
];
const goodOcr = "Iron Content (ppm)  |  8  |  10 Max  |  Pass";
const rGood = downgradeUngroundedPasses(goodBound, goodOcr);
check(
  "single-bound ถูกต้อง (result 8 + bound 10 อยู่บรรทัด) → คง PASS",
  rGood.downgraded.length === 0 && goodBound[0].status === "PASS"
);

// ★ MEDIUM (Opus review): digit-string collision ฝั่ง keep ★ — result 42.3 ยืมมา, บรรทัดมี 423 (คนละค่า)
//   exact-value match → 42.3 ≠ 423 → ไม่ co-locate → downgrade (เดิม digit-string "423"=="423" keep ปลอม)
const DIGIT_OCR = "Viscosity (cP)  |  423  |  100~500  |  Pass\nDensity (g/L)  |  42.3  |  40~50  |  Pass";
const digitRow = [
  row({ name: "Viscosity (cP)", specRaw: "100~500", min: 100, max: 500, result: 42.3, resultRaw: "42.3" }),
];
const rDigit = downgradeUngroundedPasses(digitRow, DIGIT_OCR);
check(
  "digit-string collision (42.3 vs 423) → exact-value ไม่ match → downgrade (MEDIUM fixed)",
  rDigit.downgraded.length === 1 && digitRow[0].status === "SKIP",
  `(downgraded=${rDigit.downgraded.length})`
);

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
