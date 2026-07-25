import { evaluateCoa, formatReport, Status } from "./coa-evaluator";

// Mock: Inolob T204F (single "Specification" column with ranges + "White")
const inolob = evaluateCoa({
  filename: "20260305_Inolob_T204F.pdf",
  product: "POLYTETRAFLUOROETHYLENE INOLUB T204F",
  lotNo: "4303L5204S",
  items: [
    { name: "Colour",            unit: "-",        specRaw: "White",   result: "White" },
    { name: "Bulk Density",      unit: "g/l",      specRaw: "275-425", result: "387" },
    { name: "Partical Size D50", unit: "μm",       specRaw: "2-6",     result: "3.47" },
    { name: "Melt Flow Rate",    unit: "g/10 min", specRaw: "2-4",     result: "2.12" },
    { name: "Melting point",     unit: "°C",       specRaw: "326-330", result: "328.86" },
  ],
});

// Mock: TR_1099 (separate Min/Max cols + Avg result)
const teijin = evaluateCoa({
  filename: "20260306_TR_1099.pdf",
  product: "TWARON® PULP 1099",
  lotNo: "100027797",
  items: [
    { name: "Fiber length av. (LL)",   unit: "mm",     specMin: "0.90", specMax: "1.35", result: { avg: 1.00, min: undefined, max: undefined, raw: "1.00" } },
    { name: "Specific Surface Area",   unit: "m2/g",   specMin: "9.00", specMax: "13.00", result: { avg: 11.15, raw: "11.15" } },
    { name: "Moisture content",        unit: "%(m/m)", specMin: "4.0",  specMax: "8.0",   result: { avg: 6.5, raw: "6.5" } },
  ],
});

// Mock: TXAX-A (≤, ~, equal text)
const txax = evaluateCoa({
  filename: "20260513_TXAX-A.pdf",
  product: "TXAX-A (Potassium Hexatitanate)",
  lotNo: "A-63045",
  items: [
    { name: "Color",           specRaw: "Light Yellow Color", result: "Light Yellow Color" },
    { name: "Chemical Formula", specRaw: "K2Ti6O13",          result: "K2Ti6O13" },
    { name: "Median Diameter", unit: "μm",  specRaw: "40.0 ~ 70.0", result: "54.1" },
    { name: "pH",                          specRaw: "7.0 ~ 9.0",   result: "7.7" },
    { name: "Moisture Content", unit: "%", specRaw: "≦ 0.2",       result: "0.09" },
    { name: "Bulk Density",     unit: "g/cm3", specRaw: "0.33 ~ 0.53", result: "0.43" },
  ],
});

// Mock: D-2072 (mix of ± and ≥)
const d2072 = evaluateCoa({
  filename: "20260513_D-2072.pdf",
  product: "CS-2402-02",
  lotNo: "D-2072",
  items: [
    { name: "Viscosity",            specRaw: "7 ± 3",   result: "6.6" },
    { name: "Solid Content",        unit: "%",    specRaw: "26.0 ± 2.0",  result: "27.06" },
    { name: "Shear Strength (Room)",specRaw: "120 ± 30", result: "124.9" },
    { name: "Heat Resistance",      specRaw: "≥ 50",     result: "136.5" },
  ],
});

// Mock failing case
const failing = evaluateCoa({
  filename: "synthetic-failing.pdf",
  items: [
    { name: "Should Fail (over max)",   specRaw: "0-10",    result: "11" },
    { name: "Should Fail (under min)",  specRaw: "10-20",   result: "9.99" },
    { name: "Should Fail (above le)",   specRaw: "≤ 5",     result: "5.01" },
    { name: "Should Fail (below ge)",   specRaw: "≥ 50",    result: "49.9" },
  ],
});

// Mock: RB220 (Rockwool/Lapinus) — ★ ไม่มีคอลัมน์ result เดี่ยว ★ ฝั่งผลแตกเป็น Results Min|Max
//   เทียบ Limits Min|Max (แถว shot มี Limits แค่ Max) → ช่วงที่วัดได้ต้องอยู่ในกรอบ spec ทั้งช่วง
const rb220 = evaluateCoa({
  filename: "20260514_RB220_72700403.pdf",
  product: "Lapinus® RB220ELS",
  lotNo: "72700403",
  items: [
    { name: "Fibre length", unit: "μm",  specMin: "180", specMax: "280", resultMin: "200,00", resultMax: "250,00" },
    { name: "Shot > 63 μm", unit: "%wt", specMax: "0.5",                 resultMin: "0,07",   resultMax: "0,28" },
  ],
});

// Mock: interval edge cases — ขอบหลุดต้อง FAIL (ห้ามยุบเป็นค่าเฉลี่ยแล้วผ่าน)
const intervals = evaluateCoa({
  filename: "synthetic-interval.pdf",
  items: [
    // ★ regression ตัวสำคัญ ★ เดิมเฉลี่ย (0.4+0.6)/2 = 0.5 → PASS ปลอม; ตอนนี้ max 0.6 หลุด ≤0.5 → FAIL
    { name: "max หลุด one-sided",  specRaw: "≤ 0.5",   resultMin: "0.4", resultMax: "0.6" },
    { name: "max หลุด between",    specRaw: "180-280", resultMin: "200", resultMax: "300" },
    { name: "min หลุด between",    specRaw: "180-280", resultMin: "170", resultMax: "250" },
    { name: "min หลุด lower",      specRaw: "≥ 180",   resultMin: "170", resultMax: "250" },
    { name: "ทั้งช่วงเข้า between", specRaw: "180-280", resultMin: "200", resultMax: "250" },
    { name: "ทั้งช่วงเข้า lower",   specRaw: "≥ 180",   resultMin: "200", resultMax: "250" },
    { name: "ช่วงยุบ (min=max)",    specRaw: "180-280", resultMin: "200", resultMax: "200" },
    { name: "ขอบตรง spec พอดี",     specRaw: "180-280", resultMin: "180", resultMax: "250" },
    { name: "spec เลขเดี่ยวไม่มีทิศ", specRaw: "0.5",   resultMin: "0.07", resultMax: "0.28" },
  ],
});

// Mock: KGP-H65 (関西マテック 試験成績表) — ใบญี่ปุ่น: 規格値 ใช้ 以下 (≤) / 以上 (≥) / ±
//   ★ ชื่อ D50/D90 ซ้ำ 2 ชุด (เครื่องวัด LMS-30 vs S3500) spec ต่างกัน — ห้ามสลับชุด ★
const kgpH65 = evaluateCoa({
  filename: "20260527_KGP-H65_Lot_25110901.pdf",
  product: "ウォラストナイト KGP-H65",
  lotNo: "25110901",
  items: [
    { name: "粒度 D50 (LMS-30)", unit: "μm",   specRaw: "6.5±1.0",    result: "6.5" },
    { name: "粒度 D90 (LMS-30)", unit: "μm",   specRaw: "50以下",      result: "29.0" },
    { name: "粒度 D50 (S3500)",  unit: "μm",   specRaw: "13.0±3.0",   result: "13.3" },
    { name: "粒度 D90 (S3500)",  unit: "μm",   specRaw: "70以下",      result: "62.0" },
    { name: "嵩密度",            unit: "g/ml", specRaw: "0.23±0.06",  result: "0.23" },
    { name: "SiO2+CaO",          unit: "%",    specRaw: "94以上",      result: "96.85" },
    { name: "Fe2O3",             unit: "%",    specRaw: "0.5以下",     result: "0.40" },
  ],
});

for (const r of [inolob, teijin, txax, d2072, failing, rb220, intervals, kgpH65]) {
  console.log(formatReport(r));
}

// ── expected status ของ fixture interval (print-based เหมือนเดิม แต่บอกชัดว่าตรง/ไม่ตรง) ──
const expected: Record<string, Status> = {
  "Fibre length": "PASS",
  "Shot > 63 μm": "PASS",
  "max หลุด one-sided": "FAIL",
  "max หลุด between": "FAIL",
  "min หลุด between": "FAIL",
  "min หลุด lower": "FAIL",
  "ทั้งช่วงเข้า between": "PASS",
  "ทั้งช่วงเข้า lower": "PASS",
  "ช่วงยุบ (min=max)": "PASS",
  "ขอบตรง spec พอดี": "SKIP", // anti-fabricated-PASS: ขอบ result ตรงขอบ spec พอดี → ให้คนเทียบใบจริง
  "spec เลขเดี่ยวไม่มีทิศ": "SKIP",
  // KGP-H65 — ใบญี่ปุ่นระบุ 合格 (PASS) ทั้ง 7 แถว
  "粒度 D50 (LMS-30)": "PASS",
  "粒度 D90 (LMS-30)": "PASS",
  "粒度 D50 (S3500)": "PASS",
  "粒度 D90 (S3500)": "PASS",
  "嵩密度": "PASS",
  "SiO2+CaO": "PASS",
  "Fe2O3": "PASS",
};
let bad = 0;
for (const rep of [rb220, intervals, kgpH65]) {
  for (const row of rep.rows) {
    const want = expected[row.name];
    if (!want) continue;
    const ok = row.status === want;
    if (!ok) bad++;
    console.log(
      `${ok ? "✓" : "✗"} ${row.name.padEnd(24)} want=${want.padEnd(4)} got=${row.status.padEnd(4)} result=${row.resultMin ?? "-"}–${row.resultMax ?? "-"} (binding ${row.result ?? "-"})`
    );
  }
}
console.log(bad === 0 ? "\nINTERVAL FIXTURES: all match" : `\nINTERVAL FIXTURES: ${bad} MISMATCH`);
