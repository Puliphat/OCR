// Print-based regression test — รัน: npx ts-node src/services/coa/avg-column-recovery.test.ts
// ยืนยัน recoverAverageColumn ดึงคอลัมน์ Average จาก column-aware grid แบบ deterministic +
//   ABSTAIN เมื่อไม่มี header avg / ค่าไม่ใช่เลข (กัน override ผิด) + override เฉพาะตอนค่าเปลี่ยนจริง
import { recoverAverageColumn } from "./avg-column-recovery";
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

// ── 1) Lot240521 REAL grid (rapidocr reconstructTextGrid, rotated scan) — the motivating case ──
//   Average column sits at global band 8, spec ("Standardized Values") at band 9. The LLM picked the
//   last measurement 58 for the 150μ row instead of the Average 56.0.
const LOT240521_GRID = [
  "  |    |    |    |    |    |    |    |    |    |    |  2024年9月",
  "  |    |  Inspection Data of Rubber Powder  |    |    |    |    |    |    |    |    |  月5日10时55分",
  "Trade Narme  |  Rubber Powder 4000  |    |  Lot Nurriber  |    |    |    |  240521  |    |  Shipment Day  |  Sep.5.2024  |  日惠化工！",
  "  |  Quality Item  |    |    |    |    |    |    |  Average  |  Standardized Yalues  |  Success cr Failure",
  "Sieve Residue on 500 μ(%)  |    |    |    |    |    |    |    |  0.3  |  3 Max.  |  Success",
  "SieveResidueon350ur%)  |    |    |    |  42  |    |  41  |    |  42.3  |  15 ~45  |  Suncess",
  "SicveResidueQn 150ur%)  |    |    |  54  |  56  |    |  58  |    |  56.0  |  45 ~T5  |  Success",
  "Sieve Residue under 150p(%)  |    |    |    |    |    |    |    |  1.3  |  20 Max  |  Success",
  "  |  Bulk Deusityke/L)  |    |  330  |  322  |    |  335  |    |  329.0  |  270 -~350  |  Success",
].join("\n");

// items as the LLM (qwen3:4b) actually returned them on this file (result=58 is the bug)
const lotItems: RawCoaItem[] = [
  { name: "Sieve Residue on 500 μ(%)", specRaw: "3 Max.", result: "0.3" },
  { name: "Sieve Residue on 350ur%)", specRaw: "15 ~45", result: "42.3" },
  { name: "Sieve Residue on 150ur%)", specRaw: "45 ~T5", result: "58" }, // ← bug: should be 56.0
  { name: "Sieve Residue under 150p(%)", specRaw: "20 Max", result: "1.3" },
  { name: "Bulk Deusityke/L)", specRaw: "270 -~350", result: "329" },
];

console.log("[1] Lot240521 real rotated-scan grid");
const r1 = recoverAverageColumn(lotItems, LOT240521_GRID);
check(
  "exactly 1 row overridden (only the 150μ row differs from its avg)",
  r1.overridden.length === 1,
  `got ${r1.overridden.length}: ${JSON.stringify(r1.overridden)}`
);
check(
  "150μ result 58 → 56.0 (Average column)",
  lotItems[2].result === "56.0",
  `got ${lotItems[2].result}`
);
check("override records from=58 to=56.0", r1.overridden[0]?.from === "58" && r1.overridden[0]?.to === "56.0");
check("rows already holding the avg are untouched (0.3/42.3/1.3/329)",
  lotItems[0].result === "0.3" && lotItems[1].result === "42.3" &&
  lotItems[3].result === "1.3" && lotItems[4].result === "329");

// ── 2) result dropped by the LLM (null) → filled from the avg column ──
console.log("\n[2] fill a null result from the avg column");
const nullItems: RawCoaItem[] = [
  { name: "A", specRaw: "10~20", result: null },
  { name: "B", specRaw: "30~40", result: "35" },
];
const grid2 = [
  "Item | m1 | m2 | Average | Spec",
  "A | 14 | 16 | 15 | 10~20",
  "B | 34 | 36 | 35 | 30~40",
].join("\n");
const r2 = recoverAverageColumn(nullItems, grid2);
check("null result A filled to 15", nullItems[0].result === "15", `got ${nullItems[0].result}`);
check("B unchanged (already == avg)", nullItems[1].result === "35" && r2.overridden.length === 1);

// ── 3) ABSTAIN: no Average/Mean header → nothing overridden ──
console.log("\n[3] no avg header → abstain");
const noHdrItems: RawCoaItem[] = [{ name: "A", specRaw: "10~20", result: "99" }];
const grid3 = ["Item | Result | Spec", "A | 99 | 10~20"].join("\n");
const r3 = recoverAverageColumn(noHdrItems, grid3);
check("no override when no avg header", r3.overridden.length === 0 && noHdrItems[0].result === "99");

// ── 4) ABSTAIN: avg column present but cell is non-numeric → keep LLM value ──
console.log("\n[4] non-numeric avg cell → keep LLM value");
const nonNumItems: RawCoaItem[] = [
  { name: "A", specRaw: "10~20", result: "15" },
  { name: "B", specRaw: "30~40", result: "35" },
  { name: "C", specRaw: "white", result: "White" },
];
const grid4 = [
  "Item | Average | Spec",
  "A | 15 | 10~20",
  "B | 35 | 30~40",
  "C | White | white",
].join("\n");
const r4 = recoverAverageColumn(nonNumItems, grid4);
check("non-numeric avg cell (C) not overridden", nonNumItems[2].result === "White" && r4.overridden.length === 0);

// ── 5) "Mean" header keyword also recognized ──
console.log("\n[5] 'Mean' header keyword");
const meanItems: RawCoaItem[] = [{ name: "A", specRaw: "10~20", result: "18" }];
const grid5 = ["Item | m1 | m2 | Mean | Spec", "A | 16 | 14 | 15 | 10~20"].join("\n");
// only 1 numeric row → below the ≥2 evidence floor → abstain
const r5 = recoverAverageColumn(meanItems, grid5);
check("single-row table abstains (≥2 evidence rows required)", r5.overridden.length === 0 && meanItems[0].result === "18");

// ── 6) ambiguous spec key (two rows same spec, different avg) → that key abstains, falls back to name ──
console.log("\n[6] duplicate spec collision → name-key fallback");
const dupItems: RawCoaItem[] = [
  { name: "Alpha", specRaw: "0~100", result: "10" },
  { name: "Beta", specRaw: "0~100", result: "20" },
];
const grid6 = [
  "Item | Average | Spec",
  "Alpha | 11 | 0~100",
  "Beta | 22 | 0~100",
].join("\n");
const r6 = recoverAverageColumn(dupItems, grid6);
check("Alpha → 11 via name fallback (spec key collided)", dupItems[0].result === "11", `got ${dupItems[0].result}`);
check("Beta → 22 via name fallback", dupItems[1].result === "22", `got ${dupItems[1].result}`);

// ── 7) empty / flat input → no-op (never throws) ──
console.log("\n[7] defensive: empty + flat input");
check("empty grid → no override", recoverAverageColumn([{ name: "A", result: "1" }], "").overridden.length === 0);
check("flat text (no columns, no header) → no override",
  recoverAverageColumn([{ name: "A", specRaw: "1~2", result: "1" }], "A 1 1~2 Success").overridden.length === 0);

console.log(`\n${"=".repeat(50)}\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
