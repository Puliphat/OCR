// Print-based regression test — รัน: npx ts-node src/services/coa/parse-structural-grid.test.ts
// ยืนยัน parseStructuralGrid map column→role ถูกแบบ deterministic (ไม่ง้อ LLM) + ABSTAIN เมื่อ ambiguous
//   (กัน deceptive PASS) + emit spec ในรูปที่ evaluator อ่านได้ (bound word-order trap)
import { parseStructuralGrid } from "./parse-structural-grid";
import { evaluateItem } from "./coa-evaluator";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1) Suzorite transposed grid (the target case) → 5 PASS + 1 SKIP, values exact ──
const SUZORITE = [
  "Item | Method | Specifications |  |  | LOT NO. 850996",
  "Sieve Analysis | ASTM E 11-87/ ASTM C 136-84 | (Mesh, wt%) | +100 | Max 1 | Traces",
  " |  |  | -100/＋200 | Max 5 | 0.30",
  " |  |  | -200/＋325 | 1〜8 | 2.50",
  " |  |  | -325 | 92〜100 | 97.20",
  "Loose Bulk Density | ASTM D716-86 | （lb/cu-ft） | 11.0〜16.0 |  | 12.2",
  "Humidity | ASTM D 1864-81 | (％) | 0.00〜0.70 |  | 0.26",
].join("\n");

console.log("[1] Suzorite transposed grid");
const sz = parseStructuralGrid(SUZORITE, "transposed");
check("lotNo extracted", sz.lotNo === "850996", `got ${sz.lotNo}`);
check("6 items emitted", sz.items.length === 6, `got ${sz.items.length}`);
check(
  "sieve sub-rows inherit section name + mesh",
  sz.items[1].name === "Sieve Analysis -100/+200",
  `got "${sz.items[1].name}"`
);
// the load-bearing trap: word-first "Max 5" must become specMax NUMBER (not specRaw)
check(
  '"Max 5" → specMax=5 (number), specRaw null',
  sz.items[1].specMax === 5 && sz.items[1].specRaw == null,
  `got specMax=${sz.items[1].specMax} specRaw=${sz.items[1].specRaw}`
);
check(
  'range "1〜8" → specRaw verbatim',
  sz.items[2].specRaw === "1~8" && sz.items[2].specMin == null,
  `got specRaw=${sz.items[2].specRaw}`
);
check("result kept verbatim (not spec)", sz.items[4].result === "12.2", `got ${sz.items[4].result}`);

const ev = sz.items.map(evaluateItem);
const statuses = ev.map((e) => e.status);
const nPass = statuses.filter((s) => s === "PASS").length;
const nSkip = statuses.filter((s) => s === "SKIP").length;
const nFail = statuses.filter((s) => s === "FAIL").length;
check("evaluates to 5 PASS", nPass === 5, `got ${nPass}`);
check("evaluates to 1 SKIP (Traces row)", nSkip === 1, `got ${nSkip}`);
check("evaluates to 0 FAIL", nFail === 0, `got ${nFail}`);
check("+100/Traces row is the SKIP", ev[0].status === "SKIP" && ev[0].name === "Sieve Analysis +100");
check("Loose Bulk 12.2 PASS in 11~16", ev[4].status === "PASS" && ev[4].result === 12.2);
check("Humidity 0.26 PASS in 0~0.70", ev[5].status === "PASS" && ev[5].result === 0.26);

// ── 2) method codes with dashes must NOT be misread as a range spec ──
console.log("[2] method-code dash is not a range");
const METHOD_DASH = [
  "Name | Method | Spec | Result",
  "Viscosity | ASTM D2196-86 | 270~350 | 310",
].join("\n");
const md = parseStructuralGrid(METHOD_DASH, "normal");
check("1 item", md.items.length === 1, `got ${md.items.length}`);
check("method captured", md.items[0].method === "ASTM D2196-86", `got ${md.items[0].method}`);
check(
  'spec is the real range "270~350" (not "2196-86")',
  md.items[0].specRaw === "270~350",
  `got ${md.items[0].specRaw}`
);
check("result 310", md.items[0].result === "310");
check("evaluates PASS", evaluateItem(md.items[0]).status === "PASS");

// ── 3) ABSTAIN: ambiguous two-bare-number row must NOT fabricate a directioned spec → no PASS ──
//   neither column is a parseable spec (both lone numbers) → spec null → honest SKIP, never a guess.
console.log("[3] ambiguous bare/bare row abstains (no deceptive PASS)");
const AMBIG = ["Name | A | B", "Density | 1.25 | 1.40"].join("\n");
const am = parseStructuralGrid(AMBIG, "normal");
// result col picked (rightmost bare); the other bare number is NOT a spec pattern → spec null
const amEval = am.items.map(evaluateItem);
check(
  "no PASS fabricated from two bare numbers",
  amEval.every((e) => e.status !== "PASS"),
  `statuses=${amEval.map((e) => e.status).join(",")}`
);

// ── 4) number-first "5 Max" bound also routes to specMax ──
console.log("[4] number-first bound '5 Max'");
const NUMFIRST = ["Name | Spec | Result", "Ash | 5 Max | 3.2"].join("\n");
const nf = parseStructuralGrid(NUMFIRST, "normal");
check('"5 Max" → specMax=5', nf.items[0].specMax === 5, `got specMax=${nf.items[0].specMax}`);
check("3.2 ≤ 5 → PASS", evaluateItem(nf.items[0]).status === "PASS");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
