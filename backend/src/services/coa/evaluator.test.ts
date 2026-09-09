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

// Mock: comma ที่กำกวมระหว่าง EU decimal กับ US thousands — ★ ไม่เปลี่ยนค่า/verdict แค่ยกธง ★
//   corpus จริงเป็นทศนิยมทุกตัว (200,00 · 0,28 · 1,420) → เดาทิศไม่ได้ ต้องให้คนเทียบใบจริง
const commas = evaluateCoa({
  filename: "synthetic-comma.pdf",
  items: [
    { name: "กำกวม 1,500",        specRaw: "≤ 2,000",     result: "1,500" },
    { name: "กำกวม ในช่วง spec",   specRaw: "0.920~1,420", result: "1.090" },
    { name: "EU decimal 2 หลัก",   specRaw: "180-280",     resultMin: "200,00", resultMax: "250,00" },
    // 2 ตัวคั่น = comma คือหลักพันชัดเจน → ต้องได้ 1494.8 (regression: เคยแตกเป็น [1.494, 80] เฉลี่ย 40.747)
    { name: "2 ตัวคั่น ไม่กำกวม",    specRaw: "≤ 2000",      result: "1,494.80" },
    { name: "2 ตัวคั่น ฝั่ง spec",   specRaw: "1,000.5-2,000.5", result: "1500.25" },
    { name: "วันที่ ไม่ใช่หลักพัน",  specRaw: "≤ 10",        result: "07,2026" },
    // ── magnitude rule: เกณฑ์ไม่กำกวม → ใช้สเกลของเกณฑ์ตัดสินสเกลของค่าผล (ตัดสินได้ = ไม่ต้องเตือน) ──
    { name: "สเกลชี้หลักพัน",       specRaw: "1400-1600",   result: "1,500" },
    { name: "สเกลชี้ทศนิยม",        specRaw: "≤ 2",         result: "1,500" },
    // ★ ไม่ใช่ "เลือกอันที่ PASS" ★ — ทั้ง 1.2 และ 1200 หลุดเกณฑ์ กติกายังต้องให้ FAIL ที่เลขถูกสเกล
    { name: "หลักพันแล้วยัง FAIL",   specRaw: "1400-1600",   result: "1,200" },
    { name: "สเกลชี้หลักพัน (ge)",   specRaw: "≥ 1000",      result: "1,200" },
    // เกณฑ์กำกวมเอง → ห้ามเลื่อนสเกลเกณฑ์เข้าหาค่าผล (ของหลุด spec จะลากเกณฑ์มาหาตัวเอง = PASS ปลอม)
    { name: "เกณฑ์กำกวม ห้ามเดา",    specRaw: "1,400~1,600", result: "1.5" },
  ],
});

for (const r of [inolob, teijin, txax, d2072, failing, rb220, intervals, kgpH65, commas]) {
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

// ── ambiguous-thousands: ต้องยกธงเฉพาะ comma+3หลักที่ไม่มีจุดในตัวเดียวกัน (status ต้องไม่เปลี่ยน) ──
const expectFlag: Record<string, { flag: boolean; status: Status; value: number }> = {
  "กำกวม 1,500":       { flag: true,  status: "PASS", value: 1.5 },
  // 0.920 ในช่องเดียวกันพินสเกลให้ 1,420 = 1.42 → ไม่กำกวมแล้ว ห้ามเตือน (ใบจริง 1F1710)
  "กำกวม ในช่วง spec":  { flag: false, status: "PASS", value: 1.09 },
  "EU decimal 2 หลัก":  { flag: false, status: "PASS", value: 200 },
  "2 ตัวคั่น ไม่กำกวม":  { flag: false, status: "PASS", value: 1494.8 },
  "2 ตัวคั่น ฝั่ง spec": { flag: false, status: "PASS", value: 1500.25 },
  "วันที่ ไม่ใช่หลักพัน": { flag: false, status: "PASS", value: 7.2026 },
  "สเกลชี้หลักพัน":      { flag: false, status: "PASS", value: 1500 },
  "สเกลชี้ทศนิยม":       { flag: false, status: "PASS", value: 1.5 },
  "หลักพันแล้วยัง FAIL":  { flag: false, status: "FAIL", value: 1200 },
  "สเกลชี้หลักพัน (ge)":  { flag: false, status: "PASS", value: 1200 },
  "เกณฑ์กำกวม ห้ามเดา":   { flag: true,  status: "PASS", value: 1.5 },
};
let badFlag = 0;
console.log("");
for (const row of commas.rows) {
  const want = expectFlag[row.name];
  if (!want) continue;
  const got = row.ambiguousThousands === true;
  const ok = got === want.flag && row.status === want.status && row.result === want.value;
  if (!ok) badFlag++;
  console.log(
    `${ok ? "✓" : "✗"} ${row.name.padEnd(22)} flag want=${String(want.flag).padEnd(5)} got=${String(got).padEnd(5)} status=${row.status} value want=${want.value} got=${row.result ?? "-"}`
  );
}
console.log(
  badFlag === 0 ? "COMMA FIXTURES: all match" : `COMMA FIXTURES: ${badFlag} MISMATCH`
);

// ── boundary-exact ขอบเดียว (ROUND 29) — ค่าผลตรงขอบของเกณฑ์ที่บอกทิศเอง = อาจเป็นช่องเดียวกันที่ถูกยกมาซ้ำ
//    แต่ทิศที่เดาจากคอลัมน์ (เลขเปล่าใน Min/Max) ห้ามโดน — ใบจริงมีทั้งช่องเกณฑ์และช่องผลแยกกัน
const oneSidedBoundary = evaluateCoa({
  filename: "synthetic-one-sided-boundary.pdf",
  items: [
    // TAIHEIYO CMF: LLM ยกช่อง "0.5≧" ไปเป็นค่าผลด้วย → เคยได้ PASS ด้วยเลขที่ไม่มีบนใบ (ใบเขียน 0.37)
    { name: "Shot ยกช่องเกณฑ์มาเป็นผล", specRaw: "0.5≥", result: "0.5" },
    { name: "Shot ค่าจริงบนใบ",          specRaw: "1≥",   result: "0.37" },
    { name: "Moisture ค่าจริงบนใบ",      specRaw: "0.5≥", result: "0.10" },
    { name: "≤ ตรงขอบ",                 specRaw: "≦ 0.2", result: "0.2" },
    { name: "≤ ไม่ตรงขอบ",               specRaw: "≦ 0.2", result: "0.12" },
    { name: "Min. ตรงขอบ",              specRaw: "94.00 Min.", result: "94.00" },
    { name: "≥ ที่ตกจริง ยัง FAIL",       specRaw: "≥ 50",  result: "40" },
    // Residue on sieve(1mm) ในคลัง: เลขเปล่าในคอลัมน์ Max/Min → ทิศมาจากคอลัมน์ ห้าม downgrade
    { name: "เลขเปล่าคอลัมน์ Max",       specMax: "0", result: "0" },
    { name: "เลขเปล่าคอลัมน์ Min",       specMin: "0", result: "0" },
    // qwen3 ชอบเติมทั้ง specRaw และ specMin/specMax พร้อมกัน — ช่องที่มันเลือกเติมเป็นตัวชี้ขาดว่ายกเว้นไหม
    { name: "specRaw เลขเปล่า + คอลัมน์ Max", specRaw: "0.1", specMax: "0.1", result: "0.1" },
  ],
});

const expectBoundary: Record<string, Status> = {
  "Shot ยกช่องเกณฑ์มาเป็นผล": "SKIP",
  "Shot ค่าจริงบนใบ": "PASS",
  "Moisture ค่าจริงบนใบ": "PASS",
  "≤ ตรงขอบ": "SKIP",
  "≤ ไม่ตรงขอบ": "PASS",
  "Min. ตรงขอบ": "SKIP",
  "≥ ที่ตกจริง ยัง FAIL": "FAIL",
  "เลขเปล่าคอลัมน์ Max": "PASS",
  "เลขเปล่าคอลัมน์ Min": "PASS",
  "specRaw เลขเปล่า + คอลัมน์ Max": "PASS",
};
let badBoundary = 0;
console.log("");
for (const row of oneSidedBoundary.rows) {
  const want = expectBoundary[row.name];
  if (!want) continue;
  const ok = row.status === want;
  if (!ok) badBoundary++;
  console.log(
    `${ok ? "✓" : "✗"} ${row.name.padEnd(26)} want=${want.padEnd(4)} got=${row.status.padEnd(4)} min=${row.min ?? "-"} max=${row.max ?? "-"} result=${row.result ?? "-"}`
  );
}
console.log(
  badBoundary === 0
    ? "ONE-SIDED BOUNDARY FIXTURES: all match"
    : `ONE-SIDED BOUNDARY FIXTURES: ${badBoundary} MISMATCH`
);

// ให้ suite นี้ตกด้วย exit code เหมือนอีก 18 ตัว — เดิมพิมพ์ MISMATCH แล้ว exit 0 (gate มองไม่เห็น)
const totalBad = bad + badFlag + badBoundary;
if (totalBad > 0) {
  console.log(`\nEVALUATOR FIXTURES: ${totalBad} MISMATCH`);
  process.exit(1);
}
