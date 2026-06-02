// Print-based regression test (ไม่มี runner) — รัน: npx ts-node src/services/coa/spec-recovery.test.ts
// ยืนยัน: spec-recovery กู้ spec จาก OCR จริงของ Lot240521 ได้ครบ 5 + evaluator คืน 4P/1F (baseline ดี)
// และ row ที่ FAIL (423 = 42.3 ทศนิยมหาย) ถูกตั้งธง needsReview
import { recoverSpecsFromOcr, correctSpecDirectionFromOcr } from "./spec-recovery";
import { evaluateCoa } from "./coa-evaluator";
import { RawCoaItem } from "./ollama-coa.service";

// OCR จริงของ Lot240521 (จาก coa-logs/_last-ocr.txt) — เป็น scan ที่ noisy
// ★ มีบรรทัด density ซ้ำ 2 ครั้ง (line 5 + line 13) — เคสจริงที่ Tesseract อ่านซ้ำ ★
//   ใช้ lock ว่า ordered-zip ตัดบรรทัดซ้ำได้ ไม่งั้น specLines เกินจำนวน item → recovery พัง
const OCR = [
  "BS ee a a",
  "Inspection Data of Rubber Powder",
  "Nitto Kako Co.Ltd.",
  "Rubber Powder 4000 240521 Shipment Day Sep 52024",
  "Sieve Residue on 500u(%) 1 0 i 0.03 |. 3 Max| Success",
  "Sieve Residue on 350u(%) 1 «4 14:42:53. | 15-45 | Success",
  "Sieve Residue on 150u(%) 1 56 1 35 56.0 | 45-75) Success",
  "Sieve Residue under 150(%) i 2 1 13. | 20Max| success",
  "TT alk Density(EL) 336 | 322 | 33s 325.0) 270~350| Success",
  "[ROO TT",
  "By : QA Dept.",
  "Delivery Quantity: 100kg",
  "TT alk Density(EL) 336 | 322 | 33s 325.0) 270~350| Success",
].join("\n");

// จำลอง output แย่ของ gemma3 ที่ user เจอ: spec null ทุก row → เดิมได้ 5 SKIP
const items: RawCoaItem[] = [
  { name: "Sieve Residue on S00p(%)", specRaw: null, specMin: null, specMax: null, result: "0" },
  { name: "Sieve Residue on 3501(%)", specRaw: null, specMin: null, specMax: null, result: "423" },
  { name: "Sieve Residue on 1501(%)", specRaw: null, specMin: null, specMax: null, result: "56" },
  { name: "Sieve Residue under 150(%)", specRaw: null, specMin: null, specMax: null, result: "13" },
  { name: "TT alk Density(EL)", specRaw: null, specMin: null, specMax: null, result: "336" },
];

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
}

const rec = recoverSpecsFromOcr(items, OCR);
check("recovered 5 specs (ตัดบรรทัดซ้ำ)", rec.recovered === 5, `(got ${rec.recovered}, mode=${rec.mode})`);

const expectSpecs = ["3 Max", "15-45", "45-75", "20Max", "270~350"];
items.forEach((it, i) => {
  const got = (it.specRaw ?? "").replace(/\s+/g, " ");
  check(`row ${i} specRaw = "${expectSpecs[i]}"`, got === expectSpecs[i], `(got "${it.specRaw}")`);
});

// หมายเหตุ: result ที่ใส่ใน items เป็นค่าที่ gemma3 ปั้นออกมา (ทศนิยมหายบางตัว)
// จุดประสงค์ test นี้คือ "spec recovery ทำงาน" — ไม่ได้ทดสอบว่า result ถูก (นั่นเป็นเรื่อง OCR)
const report = evaluateCoa({ filename: "test", items });
check(
  "ทุก row ไม่เป็น SKIP-เพราะ-spec-หาย แล้ว",
  report.rows.every((r) => r.reason.indexOf("spec not parseable") === -1),
  `(skip=${report.summary.skip})`
);

// 423 (= 42.3 ทศนิยมหาย) เทียบ spec 15-45 → FAIL + ตั้งธง needsReview ว่าน่าจะ OCR เพี้ยน
const r423 = report.rows[1];
check("row 423 = FAIL", r423.status === "FAIL", `(got ${r423.status})`);
check("row 423 flagged needsReview", !!r423.needsReview);

// guard: ถ้า row มี spec อยู่แล้ว ห้าม recovery ไปทับ
const populated: RawCoaItem[] = [
  { name: "X", specRaw: "10-20", result: "15" },
];
recoverSpecsFromOcr(populated, "X 99 100 -200 Success");
check("ไม่ทับ spec ที่มีอยู่แล้ว", populated[0].specRaw === "10-20", `(got "${populated[0].specRaw}")`);

// ★ anti-fabricated-PASS guard ★ — ขอบช่วง = ค่าผลเป๊ะ → ต้อง SKIP ไม่ใช่ PASS (กัน spec ปลอม)
const fab = evaluateCoa({
  filename: "fab",
  items: [
    { name: "D100", specMin: "69.11", specMax: "80.0", result: "69.11" }, // result == min
    { name: "Mesh", specMin: "95", specMax: "98.9", result: "98.9" }, // result == max
    { name: "Real range", specRaw: "275-425", result: "387" }, // ปกติ → ต้อง PASS
    { name: "Real fail", specRaw: "10-20", result: "25" }, // FAIL จริง → ห้ามโดน guard
  ],
});
check("fabricated PASS (result==min) → SKIP", fab.rows[0].status === "SKIP", `(got ${fab.rows[0].status})`);
check("fabricated PASS (result==max) → SKIP", fab.rows[1].status === "SKIP", `(got ${fab.rows[1].status})`);
check("range ปกติยัง PASS", fab.rows[2].status === "PASS", `(got ${fab.rows[2].status})`);
check("FAIL จริงยัง FAIL (guard ไม่แตะ)", fab.rows[3].status === "FAIL", `(got ${fab.rows[3].status})`);

// ★ spec-direction correction ★ — LLM ทิ้ง "Max/Min" ใส่เป็น bare specMin/specMax ผิดทิศ → fabricated FAIL
//   layout จริง = "Item | Spec | Result" → result อยู่ tail; anchor ที่ค่า V กัน grab result column
const sodaOcr = [
  "Sodium chloride(NaCl)  |  0.5 Max.  |  0.28",
  "Insoluble matter in water  |  0.01 Max.  |  0.001 Max.",
  "Assay (Na2CO3)  |  99.2 Min.  |  99.5",
].join("\n");
const sodaItems: RawCoaItem[] = [
  // LLM ทิ้ง "Max" → ใส่ 0.01 เป็น specMin (bare) → เดิม ge 0.01 → 0.001 FAIL ปลอม
  { name: "Insoluble matter in water", specRaw: null, specMin: "0.01", specMax: null, result: "0.001" },
  // LLM ทิ้ง "Min" → ใส่ 99.2 เป็น specMax (bare) → เดิม le 99.2 → 99.5 FAIL ปลอม
  { name: "Assay (Na2CO3)", specRaw: null, specMin: null, specMax: "99.2", result: "99.5" },
  // ถูกแล้ว (มี specRaw) → ห้ามแตะ
  { name: "Sodium chloride (NaCl)", specRaw: "0.5 Max.", specMin: null, specMax: null, result: "0.28" },
];
const nFixed = correctSpecDirectionFromOcr(sodaItems, sodaOcr);
check("direction: แก้ 2 row", nFixed === 2, `(got ${nFixed})`);
check("Insoluble → '0.01 Max.'", (sodaItems[0].specRaw ?? "") === "0.01 Max.", `(got "${sodaItems[0].specRaw}")`);
check("Assay → '99.2 Min.'", (sodaItems[1].specRaw ?? "") === "99.2 Min.", `(got "${sodaItems[1].specRaw}")`);
check("row ที่มี specRaw อยู่แล้วไม่โดนแตะ", sodaItems[2].specRaw === "0.5 Max.");

const sodaReport = evaluateCoa({ filename: "soda", items: sodaItems });
check("Insoluble 0.001 ≤ 0.01 → PASS (ไม่ FAIL ปลอม)", sodaReport.rows[0].status === "PASS", `(got ${sodaReport.rows[0].status})`);
check("Assay 99.5 ≥ 99.2 → PASS", sodaReport.rows[1].status === "PASS", `(got ${sodaReport.rows[1].status})`);

// guard: range (min+max ครบ) = ทิศชัด → ห้ามแตะ
const rangeItems: RawCoaItem[] = [{ name: "Bulk Density", specRaw: null, specMin: "270", specMax: "350", result: "329" }];
const rf = correctSpecDirectionFromOcr(rangeItems, "Bulk Density  270 ~ 350  329");
check("range (min+max) ไม่โดนแก้ทิศ", rf === 0 && rangeItems[0].specMin === "270", `(fixed=${rf})`);

// guard: LLM ถูกอยู่แล้ว (specMax bare 0.2, OCR "0.2 Max") → no-op ในผล (le 0.2 เท่าเดิม)
const okItems: RawCoaItem[] = [{ name: "Moisture content", specRaw: null, specMin: null, specMax: "0.2", result: "0.09" }];
correctSpecDirectionFromOcr(okItems, "Moisture content  |  0.2 Max  |  0.09");
const okReport = evaluateCoa({ filename: "ok", items: okItems });
check("LLM ถูกอยู่แล้ว → ยัง PASS (le 0.2)", okReport.rows[0].status === "PASS", `(got ${okReport.rows[0].status})`);

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
