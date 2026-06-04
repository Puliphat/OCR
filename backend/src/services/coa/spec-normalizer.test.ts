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
  ["< 15",           { op: "lt", value: 15 }],
  ["> 50",           { op: "gt", value: 50 }],
  ["0",              { op: "eq", value: 0 }],
  ["180",            { op: "eq", value: 180 }],
  ["270 -~350",      { op: "between", min: 270, max: 350 }],
  ["270 ~- 350",     { op: "between", min: 270, max: 350 }],
  ["40.0 ~ - 70.0",  { op: "between", min: 40, max: 70 }],
  ["15 -45",         { op: "between", min: 15, max: 45 }],
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
