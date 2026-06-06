// Print-based regression test — run: npx ts-node src/services/coa/spec-column-recovery.test.ts
// Verifies recoverSpecificationColumn picks the RIGHT (Specification) Min/Max pair on DuPont
//   double-min/max grids, REJECTS mangled cells instead of falling through to a neighbour column
//   (the fabricated-spec trap), needs ≥2 agreeing blocks, and abstains entirely off-layout.
import { recoverSpecificationColumn } from "./spec-column-recovery";
import { RawCoaItem } from "./ollama-coa.service";

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

// ── 1) REAL 1F1710 grid (rapidocr reconstructTextGrid, 2 blocks) — the motivating case ──
//   Batch group = bands 3,4 · Specification group = bands 8,9 (rightmost Min/Max).
//   block 1 Percent Moisture spec-min cell is OCR-mangled "S.000" → that row MUST be rejected,
//   NOT read as the Aim cell (6.500). With only 1 clean Percent read it abstains (≥2 floor).
const F1710_2BLOCK = [
  "  |    |  Batch  |    |    |    |    |  Spccification",
  "Property  |  UoM  |  Avg  |  Min!  |  Max  |  Std  |  Ain  |    |  Min  |  Max",
  "Canadian Std Freeness  |    |  241.417  |  217.000  |  248.500  |  12.097  |  260.000  |    |  160.000  |  360.000",
  "Fiber Length  |  mm  |  1.090  |  0.990  |  1.180  |  0.069  |  1.170  |    |  0.920  |  1.420",
  "Percent Moisture  |    |  8.100  |  5.400  |  9.500  |  0.600  |  6.500  |    |  S.000  |  11.000",
  "  |    |  Batch  |    |    |    |    |  Specification",
  "Property  |  UoM  |  Avg  |  Min  |  Max  |  Std  |  Aim  |    |  Min  |  Max",
  "Canadian Std Freeness  |    |  241.417  |  217.000  |  248.500  |  12.097  |  260.000  |    |  160.000  |  360.000",
  "Fiber Length  |  mm  |  1.090  |  0.990  |  1.180  |  0.069  |  1.170  |    |  0.920  |  1.420",
  "Percent Moisture  |    |  8.100  |  5.400  |  9.500  |  0.600  |  6.500  |    |  5.000  |  11.000",
].join("\n");

const items1: RawCoaItem[] = [
  { name: "Canadian Std Freeness", specRaw: "217~248.5", result: "241.417" }, // batch range (wrong)
  { name: "Fiber Length", specRaw: "0.990~1.180", result: "1.090" }, // batch range (wrong)
  { name: "Percent Moisture", specRaw: "5.4~9.5", result: "8.100" }, // batch range (wrong)
];

console.log("[1] real 1F1710 double-min/max grid");
const r1 = recoverSpecificationColumn(items1, F1710_2BLOCK);
check(
  "Fiber Length spec → 0.920~1.420 (Specification group, not Batch 0.990~1.180)",
  items1[1].specRaw === "0.920~1.420",
  `got ${items1[1].specRaw}`
);
check(
  "Canadian Std Freeness spec → 160.000~360.000",
  items1[0].specRaw === "160.000~360.000",
  `got ${items1[0].specRaw}`
);
check(
  "★ SAFETY: Percent Moisture NOT overridden to 6.500~11.000 (mangled min rejected, not fell through to Aim)",
  items1[2].specRaw !== "6.500~11.000",
  `got ${items1[2].specRaw}`
);
check(
  "Percent Moisture abstains (only 1 clean read < 2-block floor) → keeps LLM spec 5.4~9.5",
  items1[2].specRaw === "5.4~9.5",
  `got ${items1[2].specRaw}`
);
check("overridden cleared specMin/specMax (range form only)", items1[1].specMin == null && items1[1].specMax == null);
check(
  "all 3 names flagged as DuPont-layout rows (amber even when not overridden)",
  ["Canadian Std Freeness", "Fiber Length", "Percent Moisture"].every((n) => r1.dupontNames.includes(n)),
  `got ${JSON.stringify(r1.dupontNames)}`
);

// ── 2) majority over an outlier read — 2×(5~11) beats 1×(6.5~11) ──
console.log("\n[2] strict-majority modal pick over a drifted outlier");
const grid2 = [
  "Batch  |  Specification",
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "Pct Moisture  |  8.1  |  5.4  |  9.5  |  0.6  |  6.5  |  11.0", // outlier: spec-min reads 6.5
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "Pct Moisture  |  8.1  |  5.4  |  9.5  |  0.6  |  5.0  |  11.0",
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "Pct Moisture  |  8.1  |  5.4  |  9.5  |  0.6  |  5.0  |  11.0",
].join("\n");
const items2: RawCoaItem[] = [{ name: "Pct Moisture", specRaw: "5.4~9.5", result: "8.1" }];
recoverSpecificationColumn(items2, grid2);
check("modal (5.0~11.0) wins over outlier (6.5~11.0)", items2[0].specRaw === "5.0~11.0", `got ${items2[0].specRaw}`);

// ── 3) GATE: single Min/Max + Specification keyword → not DuPont → abstain ──
console.log("\n[3] single-group spec table → abstain (no double Min/Max)");
const grid3 = ["Property  |  Result  |  Specification", "Item A  |  5  |  Min", "Item A  |  5  |  1~10"].join("\n");
const items3: RawCoaItem[] = [{ name: "Item A", specRaw: "1~10", result: "5" }];
const r3 = recoverSpecificationColumn(items3, grid3);
check("no override + no dupontNames on single-group grid", r3.overridden.length === 0 && r3.dupontNames.length === 0);
check("Item A spec untouched", items3[0].specRaw === "1~10");

// ── 4) GATE: double Min/Max but NO Specification keyword → abstain ──
console.log("\n[4] double Min/Max without a Specification header → abstain");
const grid4 = [
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "X  |  5  |  1  |  9  |  0.1  |  0  |  10",
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "X  |  5  |  1  |  9  |  0.1  |  0  |  10",
].join("\n");
const items4: RawCoaItem[] = [{ name: "X", specRaw: "1~9", result: "5" }];
const r4 = recoverSpecificationColumn(items4, grid4);
check("abstain without Specification keyword", r4.overridden.length === 0 && items4[0].specRaw === "1~9");

// ── 5) flat text (no columns) → no-op ──
console.log("\n[5] flat text → no-op");
const r5 = recoverSpecificationColumn([{ name: "A", specRaw: "1~2", result: "1" }], "A 1 1~2 Specification Min Max");
check("flat text → empty", r5.overridden.length === 0 && r5.dupontNames.length === 0);

// ── 6) empty input → never throws ──
console.log("\n[6] defensive: empty input");
check("empty items → empty", recoverSpecificationColumn([], F1710_2BLOCK).overridden.length === 0);
check("empty grid → empty", recoverSpecificationColumn(items1, "").overridden.length === 0);

// ── 7) fuzzy name pooling — OCR-garbled grid names still aggregate to the clean LLM item ──
console.log("\n[7] OCR-garbled grid names pool via fuzzy match");
const grid7 = [
  "Batch  |  Specification",
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "Canalian Stu Freencss  |  241  |  217  |  248  |  12  |  160.000  |  360.000", // garble #1
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "Caadian Std Freeness  |  241  |  217  |  248  |  12  |  160.000  |  360.000", // garble #2
].join("\n");
const items7: RawCoaItem[] = [{ name: "Canadian Std Freeness", specRaw: "217~248", result: "241" }];
const r7 = recoverSpecificationColumn(items7, grid7);
check(
  "garbled names pool → Canadian overridden to 160.000~360.000",
  items7[0].specRaw === "160.000~360.000",
  `got ${items7[0].specRaw}`
);
check("garbled clean item flagged DuPont", r7.dupontNames.includes("Canadian Std Freeness"));

// ── 8) distinct properties never cross-match (no spurious merge) ──
console.log("\n[8] distinct DuPont properties do not cross-match");
const grid8 = [
  "Batch  |  Specification",
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "Fiber Length  |  1.09  |  0.99  |  1.18  |  0.06  |  0.92  |  1.42",
  "Percent Moisture  |  8.1  |  5.4  |  9.5  |  0.6  |  5.0  |  11.0",
  "Property  |  Avg  |  Min  |  Max  |  Std  |  Min  |  Max",
  "Fiber Length  |  1.09  |  0.99  |  1.18  |  0.06  |  0.92  |  1.42",
  "Percent Moisture  |  8.1  |  5.4  |  9.5  |  0.6  |  5.0  |  11.0",
].join("\n");
const items8: RawCoaItem[] = [
  { name: "Fiber Length", specRaw: "0.99~1.18", result: "1.09" },
  { name: "Percent Moisture", specRaw: "5.4~9.5", result: "8.1" },
];
recoverSpecificationColumn(items8, grid8);
check("Fiber → 0.92~1.42 (not merged with Moisture)", items8[0].specRaw === "0.92~1.42", `got ${items8[0].specRaw}`);
check("Moisture → 5.0~11.0 (not merged with Fiber)", items8[1].specRaw === "5.0~11.0", `got ${items8[1].specRaw}`);

console.log(`\n${"=".repeat(50)}\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
