// Print-based regression test — รัน: npx ts-node src/services/coa/coa-fail-guard.test.ts
// ยืนยัน: downgradeUngroundedFails ดาวน์เกรด FAIL ที่ spec+result คนละบรรทัด OCR (column collapse)
//   เป็น SKIP แต่คง FAIL จริงในตารางปกติ (spec+result บรรทัดเดียว) + ไม่แตะ PASS/SKIP
import { downgradeUngroundedFails, FAIL_DOWNGRADE_REASON } from "./coa-grounding";
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
    status: "FAIL",
    reason: "result outside spec",
    specRaw: null,
    resultRaw: null,
    needsReview: false,
    ...p,
  };
}

// ★ เคสจริง Suzorite ★ — text-layer transposed: ชื่อ/result/spec คนละบรรทัด, LLM broadcast "92~100"
const SUZORITE_OCR = [
  "+100 | -100/＋200 | -325",
  "11.0～16.0 | 0.00～0.70",
  "Max 1 | Max 5 | 92～100", // spec จริง: +100=Max1, -100/+200=Max5, มีแค่ -325=92~100
  "LOT NO. 850996 | Traces | 0.30 | 97.20",
].join("\n");

const suz = [
  row({ name: "Sieve Analysis +100", specRaw: "92~100", min: 92, max: 100, result: 13.5, resultRaw: "11.0～16.0" }),
  row({ name: "Sieve Analysis -100/+200", specRaw: "92~100", min: 92, max: 100, result: 0.35, resultRaw: "0.00～0.70" }),
];
const rSuz = downgradeUngroundedFails(suz, SUZORITE_OCR);
check(
  "Suzorite: spec 92~100 broadcast → downgrade ทั้ง 2 FAIL→SKIP",
  rSuz.downgraded.length === 2 && suz.every((r) => r.status === "SKIP" && r.needsReview),
  `(downgraded=${rSuz.downgraded.length})`
);

// ★ เคสจริง Lot240521 ★ — scan transposed: spec line / result line แยกกัน, "20 Max" ผิดแถว
const LOT_OCR = [
  "Shipment Day | Stendardized Yalues | 3 Ma. | 45 ~T5 | 20 Max | 11350 | 270",
  "240521 | Average | 42.3 | 329.0",
  "Rubber Powder 4000 | Sieve Residue on 500μ(%) | Sieve Residue on 350u(%) | Sieve Residue on 150u(%)",
].join("\n");

const lot = [
  row({ name: "Sieve Residue on 500μm (%)", specRaw: "20 Max", max: 20, result: 42.3, resultRaw: "42.3" }),
  row({ name: "Sieve Residue on 150μm (%)", specRaw: "20 Max", max: 20, result: 329, resultRaw: "329.0" }),
];
const rLot = downgradeUngroundedFails(lot, LOT_OCR);
check(
  "Lot240521: spec 20 Max ผิดแถว (spec/result คนละบรรทัด) → downgrade",
  rLot.downgraded.length === 2 && lot.every((r) => r.status === "SKIP"),
  `(downgraded=${rLot.downgraded.length})`
);
check("Lot240521: reason = column collapse", lot[0].reason === FAIL_DOWNGRADE_REASON);

// ★ ตารางปกติ (name|spec|result บรรทัดเดียว) — true FAIL ต้องคง verdict ★
const CLEAN_OCR = "Sieve Residue on 500u (%) | 3 Max | 42.3";
const clean = [row({ name: "Sieve Residue 500", specRaw: "3 Max", max: 3, result: 42.3, resultRaw: "42.3" })];
const rClean = downgradeUngroundedFails(clean, CLEAN_OCR);
check(
  "ตารางปกติ spec+result บรรทัดเดียว → คง FAIL",
  rClean.downgraded.length === 0 && clean[0].status === "FAIL"
);

// decimal-loss แต่ co-locate (OCR เขียน "200" กับ spec บรรทัดเดียว) → คง FAIL
const DEC_OCR = "Bulk Density | 20 Max | 200";
const dec = [row({ name: "Bulk Density", specRaw: "20 Max", max: 20, result: 200, resultRaw: "200" })];
downgradeUngroundedFails(dec, DEC_OCR);
check("co-locate แม้ result เลขเดียวกันในบรรทัด → คง FAIL", dec[0].status === "FAIL");

// ★ ไม่แตะ PASS / SKIP ★ — แม้ row ไม่มีใน OCR เลย
const others = [
  row({ name: "Ghost PASS", status: "PASS", specRaw: "5", max: 5, result: 4, resultRaw: "4" }),
  row({ name: "Ghost SKIP", status: "SKIP", specRaw: "5", result: null, resultRaw: null }),
];
const rOther = downgradeUngroundedFails(others, CLEAN_OCR);
check(
  "PASS/SKIP ไม่ถูกแตะ (guard แตะเฉพาะ FAIL)",
  rOther.downgraded.length === 0 && others[0].status === "PASS" && others[1].status === "SKIP"
);

// mixed: 1 collapse + 1 clean (OCR รวม) → downgrade เฉพาะ collapse
const mixedOcr = SUZORITE_OCR + "\n" + CLEAN_OCR;
const mixed = [
  row({ name: "Sieve Analysis +100", specRaw: "92~100", min: 92, max: 100, result: 13.5, resultRaw: "11.0～16.0" }),
  row({ name: "Sieve Residue 500", specRaw: "3 Max", max: 3, result: 42.3, resultRaw: "42.3" }),
];
const rMixed = downgradeUngroundedFails(mixed, mixedOcr);
check(
  "mixed: downgrade collapse(+100) คง clean(500)",
  rMixed.downgraded.length === 1 && mixed[0].status === "SKIP" && mixed[1].status === "FAIL",
  `(downgraded=${rMixed.downgraded.map((d) => d.name).join("/")})`
);

// guard: OCR ว่าง → ไม่ downgrade (ไม่มีข้อมูลให้ ground)
const empty = [row({ name: "Sieve Analysis +100", specRaw: "92~100", min: 92, max: 100, result: 13.5, resultRaw: "11.0～16.0" })];
const rEmpty = downgradeUngroundedFails(empty, "");
check("OCR ว่าง → ไม่ downgrade", rEmpty.downgraded.length === 0 && empty[0].status === "FAIL");

// ★ เคสจริง _diag/Lot240521 350μ ★ — LLM comma-join cell ข้ามแถว ได้ range ปลอม "45~56"
//   (spec จริง 15~45, result 42.3 = PASS) โดย 56 ยกมาจากแถว 150μ → ต้อง downgrade
//   45 อยู่บรรทัด result (15~45) แต่ 56 ไม่อยู่ → .some เดิมปล่อยผ่าน, .every ต้องจับได้
const ASSEMBLED_OCR = [
  "Sieve Residue on 350u(%)  |  42  |  41  |  42.3  |  15 ~45  |  Success",
  "Sicve Residueon 150w(%)  |  54  |  56  |  58  |  56.0  |  45 ~T5  |  Success",
].join("\n");
const assembled = [
  row({ name: "Sieve Residue on 350u(%)", specRaw: "45~56", min: 45, max: 56, result: 42, resultRaw: "42" }),
];
const rAsm = downgradeUngroundedFails(assembled, ASSEMBLED_OCR);
check(
  "range bound ประกอบข้ามแถว (56 คนละบรรทัด result) → downgrade",
  rAsm.downgraded.length === 1 && assembled[0].status === "SKIP",
  `(downgraded=${rAsm.downgraded.length})`
);

// ตรงข้าม: between FAIL จริง bound ครบบรรทัดเดียวกับ result → คง FAIL
const REAL_RANGE_OCR = "Bulk Density (g/L)  |  40 - 70  |  85";
const realRange = [row({ name: "Bulk Density", specRaw: "40~70", min: 40, max: 70, result: 85, resultRaw: "85" })];
const rReal = downgradeUngroundedFails(realRange, REAL_RANGE_OCR);
check(
  "between FAIL จริง (40+70+85 บรรทัดเดียว) → คง FAIL",
  rReal.downgraded.length === 0 && realRange[0].status === "FAIL"
);

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
