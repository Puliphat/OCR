// Print-based regression test (ไม่มี runner) — รัน: npx ts-node src/services/coa/spec-recovery.test.ts
// ยืนยัน: spec-recovery กู้ spec จาก OCR จริงของ Lot240521 ได้ครบ 5 + evaluator คืน 4P/1F (baseline ดี)
// และ row ที่ FAIL (423 = 42.3 ทศนิยมหาย) ถูกตั้งธง needsReview
import { recoverSpecsFromOcr } from "./spec-recovery";
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

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
