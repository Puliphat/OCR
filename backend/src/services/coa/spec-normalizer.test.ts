import { normalizeSpec, normalizeSpecFromCandidate } from "./spec-normalizer";

type Expect = { op: string; min?: number; max?: number; value?: number } | null;

const cases: [string, Expect][] = [
  ["275-425",        { op: "between", min: 275, max: 425 }],
  ["2-6",            { op: "between", min: 2, max: 6 }],
  ["326-330",        { op: "between", min: 326, max: 330 }],
  ["40.0 ~ 70.0",    { op: "between", min: 40, max: 70 }],
  ["105〜115",       { op: "between", min: 105, max: 115 }],
  ["0.6~0.8",        { op: "between", min: 0.6, max: 0.8 }],
  ["0.70-1.30",      { op: "between", min: 0.7, max: 1.3 }],
  ["26.0 ± 2.0",     { op: "between", min: 24, max: 28 }],
  ["7 ± 3",          { op: "between", min: 4, max: 10 }],
  ["120 ± 30",       { op: "between", min: 90, max: 150 }],
  ["≤ 0.2",          { op: "le", value: 0.2 }],
  ["≦ 0.2",          { op: "le", value: 0.2 }],
  ["0.5 Max.",       { op: "le", value: 0.5 }],
  ["0.003 Max.",     { op: "le", value: 0.003 }],
  ["≤5.0",           { op: "le", value: 5.0 }],
  ["≦0.10",          { op: "le", value: 0.1 }],
  ["≥ 50",           { op: "ge", value: 50 }],
  ["≧ 22.5",         { op: "ge", value: 22.5 }],
  ["99.2 Min.",      { op: "ge", value: 99.2 }],
  // ใบญี่ปุ่นแนวตั้ง (TAIHEIYO CMF): เกณฑ์อยู่ซ้าย operator → "1≧ ผล" = ผลไม่เกิน 1 (ทิศกลับกับ "≧1")
  ["1≧",             { op: "le", value: 1 }],
  ["0.5≥",           { op: "le", value: 0.5 }],
  ["0.5≦",           { op: "ge", value: 0.5 }],
  ["94≦",            { op: "ge", value: 94 }],
  ["1=",             null],
  // ROUND 33 — PAG-80/Kemolit: คำนำหน้าติดเลข + OCR แทรกช่องว่างหลังจุดทศนิยม
  ["Max0.20",        { op: "le", value: 0.2 }],
  ["Max0. 50",       { op: "le", value: 0.5 }],
  ["Max10. 0",       { op: "le", value: 10 }],
  ["Min99.30",       { op: "ge", value: 99.3 }],
  ["80.00MIN",       { op: "ge", value: 80 }],
  ["0.30MAX",        { op: "le", value: 0.3 }],
  ["20. 0~30. 0",    { op: "between", min: 20, max: 30 }],
  ["Max 0.5",        { op: "le", value: 0.5 }],   // ช่องว่างคั่น — ห้ามตัด Max ทิ้งเป็น eq
  ["Min 94",         { op: "ge", value: 94 }],
  // หน่วยนาที — ห้ามเสกทิศขอบล่างจากคำว่า min ที่เป็นหน่วย (reviewer ROUND 33)
  ["30 min",          { op: "eq", value: 30 }],
  ["45 min",          { op: "eq", value: 45 }],
  ["D50 6.5 Min",     { op: "ge", value: 6.5 }],
  ["D50 6.5 Max",     { op: "le", value: 6.5 }],
  ["99.30 Min.",      { op: "ge", value: 99.3 }],
  // ROUND 33 — KGP-H65: ช่องเกณฑ์มีป้ายชื่อย่อยนำหน้า (ตัวจริงจากใบ)
  ["D50   6.5±1.0",  { op: "between", min: 5.5, max: 7.5 }],
  ["D90   50以下",     { op: "le", value: 50 }],
  ["SiO2+CaO 94以上",  { op: "ge", value: 94 }],
  ["Fe2O3 0.5以下",    { op: "le", value: 0.5 }],
  ["g/ml   0.23±0.06", { op: "between", min: 0.17, max: 0.29 }],
  ["K2Ti6O13, (TiO2)", null],  // ข้อความล้วน — ตัดป้ายแล้วก็ยังไม่มีเลข → ห้ามเสกเกณฑ์ // OCR อ่าน ≧ เป็น = → ทิศไม่รู้ ห้ามเดา ต้องปล่อย SKIP
  // ★ ROUND 34 ★ ตัดป้ายแล้วเหลือเลขเปล่า = metadata ไม่ใช่เกณฑ์ — โมดูล structural ใช้ผลตัวนี้เป็นด่านถอย
  ["Lot 240521",      null],
  ["Date 2026",       null],
  ["No. 4064",        null],
  ["Mesh 100",        null],
  ["< 15",           { op: "lt", value: 15 }],
  ["> 50",           { op: "gt", value: 50 }],
  ["0",              { op: "eq", value: 0 }],
  ["180",            { op: "eq", value: 180 }],
  ["270 -~350",      { op: "between", min: 270, max: 350 }],
  ["270 ~- 350",     { op: "between", min: 270, max: 350 }],
  ["40.0 ~ - 70.0",  { op: "between", min: 40, max: 70 }],
  ["15 -45",         { op: "between", min: 15, max: 45 }],
  // OCR garble repair (digit-shaped letters) ในบริบท range 2 ฝั่ง
  ["45 ~T5",         { op: "between", min: 45, max: 75 }],   // 75 → T5
  ["1OO-2OO",        { op: "between", min: 100, max: 200 }], // 0 → O
  ["4S~6S",          { op: "between", min: 45, max: 65 }],   // 5 → S
  ["Pass~Fail", null],   // คำล้วน ไม่มี digit ทั้งคู่ → ห้ามเสกเลข
  ["White", null],
  ["K2Ti6O13", null],
  ["Powder without foreign body", null],
  ["", null],
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = normalizeSpec(input);
  let ok: boolean;
  if (expected === null) ok = got === null;
  else {
    ok = got !== null && got.op === expected.op &&
      (expected.min === undefined || Math.abs((got.min as number) - expected.min) < 1e-9) &&
      (expected.max === undefined || Math.abs((got.max as number) - expected.max) < 1e-9) &&
      (expected.value === undefined || Math.abs((got.value as number) - expected.value) < 1e-9);
  }
  if (ok) pass++;
  else { fail++; console.log("FAIL", JSON.stringify(input), "exp=", JSON.stringify(expected), "got=", JSON.stringify(got)); }
}

const candCases: [any, any][] = [
  [{ min: "0.90", max: "1.35" },  { op: "between", min: 0.90, max: 1.35 }],
  [{ min: "9.00", max: "13.00" }, { op: "between", min: 9, max: 13 }],
  [{ min: "93%",  max: "97%"  },  { op: "between", min: 93, max: 97 }],
  [{ min: null,   max: "0.20%" }, { op: "le", value: 0.20 }],
  [{ min: "6.0",  max: null   },  { op: "ge", value: 6.0 }],
  [{ specRaw: "275-425" },        { op: "between", min: 275, max: 425 }],
  // LLM ใส่ spec ผิดช่อง — ต้องเคารพ operator ในค่า ไม่ใช่ทิศของ column (กัน fabricated PASS/FAIL)
  [{ min: null,   max: "≥ 50" },     { op: "ge", value: 50 }],
  [{ min: "≤ 0.2", max: null  },     { op: "le", value: 0.2 }],
  [{ min: null,   max: "120 ± 30" }, { op: "between", min: 90, max: 150 }],
  // LLM ใส่ทั้ง specRaw (ถูก) + bare min/max (ผิดทิศ) พร้อมกัน → specRaw ที่มี operator ชนะ
  [{ specRaw: "0.01 Max.", min: "0.01" }, { op: "le", value: 0.01 }],   // SODA Insoluble (เคย ge ผิด)
  [{ specRaw: "99.2 Min.", min: "99.2" }, { op: "ge", value: 99.2 }],
  [{ specRaw: "275-425", min: "275", max: "425" }, { op: "between", min: 275, max: 425 }],
];
for (const [input, expected] of candCases) {
  const got = normalizeSpecFromCandidate(input);
  const ok = got !== null && got.op === expected.op &&
    (expected.min === undefined || Math.abs((got.min as number) - expected.min) < 1e-9) &&
    (expected.max === undefined || Math.abs((got.max as number) - expected.max) < 1e-9) &&
    (expected.value === undefined || Math.abs((got.value as number) - expected.value) < 1e-9);
  if (ok) pass++;
  else { fail++; console.log("FAIL CAND", JSON.stringify(input), "exp=", JSON.stringify(expected), "got=", JSON.stringify(got)); }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
