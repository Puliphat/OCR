// Unit test (print-based, ไม่มี test runner) — ครอบ filterMetadataRows
// รัน: npx ts-node src/services/coa/metadata-row-filter.test.ts
import { filterMetadataRows } from "./metadata-row-filter";
import { CoaItemInput } from "./coa-evaluator";

let passed = 0;
let failed = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const ok =
    typeof expected === "boolean"
      ? actual === expected
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    console.error(`        expected: ${JSON.stringify(expected)}`);
    console.error(`        actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// helper: item ไม่มี spec ไม่มี result (junk)
function junk(name: string): CoaItemInput {
  return { name, specRaw: null, specMin: null, specMax: null, result: null };
}

// ─── กลุ่ม DROP ───────────────────────────────────────────────────────────────
console.log("\n[DROP] junk metadata rows ต้องถูกกรองออก");

{
  // garble variants ของ "Lot number"
  const cases: string[] = [
    "Lot number 1",
    "Lot mumber 1",
    "Lot number I",
    "Lotmumber",
    "lot number",
    "LOT NUMBER",
    "Lot Number 2A",
  ];
  for (const name of cases) {
    const { kept, dropped } = filterMetadataRows([junk(name)]);
    expect(`drop "${name}"`, dropped.length === 1 && kept.length === 0, true);
  }
}

{
  // garble variants ของ "Production Date"
  const cases: string[] = [
    "Production Date",
    "Praduction Date",
    "production date",
    "PRODUCTION DATE",
  ];
  for (const name of cases) {
    const { kept, dropped } = filterMetadataRows([junk(name)]);
    expect(`drop "${name}"`, dropped.length === 1 && kept.length === 0, true);
  }
}

{
  // ACCEPT exact
  const { kept, dropped } = filterMetadataRows([junk("ACCEPT")]);
  expect('drop "ACCEPT"', dropped.length === 1 && kept.length === 0, true);
}

{
  // Item exact (header)
  const { kept, dropped } = filterMetadataRows([junk("Item")]);
  expect('drop "Item" (exact header)', dropped.length === 1 && kept.length === 0, true);
}

// ─── กลุ่ม KEEP ───────────────────────────────────────────────────────────────
console.log("\n[KEEP] rows ปกติและ edge case ต้องไม่ถูกกรองออก");

{
  // row ชื่อปกติ (ไม่ match pattern เลย)
  const cases: string[] = ["Moisture", "Fiber Length", "Bulk Density", "pH", "Colour"];
  for (const name of cases) {
    const { kept, dropped } = filterMetadataRows([junk(name)]);
    expect(`keep "${name}"`, kept.length === 1 && dropped.length === 0, true);
  }
}

{
  // "Item" ที่มี spec จริง → ต้อง keep แม้ชื่อ match pattern
  const itemWithSpec: CoaItemInput = {
    name: "Item",
    specRaw: "5-10",
    specMin: null,
    specMax: null,
    result: "7",
  };
  const { kept, dropped } = filterMetadataRows([itemWithSpec]);
  expect('"Item" ที่มี spec (5-10) → keep', kept.length === 1 && dropped.length === 0, true);
}

{
  // "Lot number" ที่ดันมี specMin=5 → keep (มี spec จริง)
  const lotWithSpec: CoaItemInput = {
    name: "Lot number",
    specRaw: null,
    specMin: "5",
    specMax: null,
    result: "7",
  };
  const { kept, dropped } = filterMetadataRows([lotWithSpec]);
  expect('"Lot number" ที่มี specMin=5 → keep', kept.length === 1 && dropped.length === 0, true);
}

{
  // "Acceptance criteria xyz" — ไม่ match ^accept$ (มีคำอื่นต่อท้าย)
  const { kept, dropped } = filterMetadataRows([junk("Acceptance criteria xyz")]);
  expect('"Acceptance criteria xyz" → keep (ไม่ match ^accept$)', kept.length === 1 && dropped.length === 0, true);
}

{
  // "Items tested" — ไม่ match ^item$ (มีคำต่อท้าย)
  const { kept, dropped } = filterMetadataRows([junk("Items tested")]);
  expect('"Items tested" → keep (ไม่ match ^item$)', kept.length === 1 && dropped.length === 0, true);
}

{
  // "Item No." — ไม่ match ^item$
  const { kept, dropped } = filterMetadataRows([junk("Item No.")]);
  expect('"Item No." → keep (ไม่ match ^item$)', kept.length === 1 && dropped.length === 0, true);
}

// ─── กลุ่ม MIXED ──────────────────────────────────────────────────────────────
console.log("\n[MIXED] batch ผสม junk + real items");

{
  const items: CoaItemInput[] = [
    junk("Lot number 1"),
    junk("Praduction Date"),
    junk("ACCEPT"),
    junk("Item"),
    { name: "Moisture", specRaw: "≤ 0.5", result: "0.3" },
    { name: "Fiber Length", specMin: "0.90", specMax: "1.35", result: "1.00" },
  ];
  const { kept, dropped } = filterMetadataRows(items);
  expect("batch: dropped 4 junk rows", dropped.length, 4);
  expect("batch: kept 2 real rows", kept.length, 2);
  expect("batch: kept[0].name", kept[0].name, "Moisture");
  expect("batch: kept[1].name", kept[1].name, "Fiber Length");
}

// ─── สรุป ─────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
if (failed === 0) {
  console.log(`PASS  ทุก test ผ่าน (${passed} cases)`);
  process.exit(0);
} else {
  console.error(`FAIL  ${failed}/${passed + failed} cases ไม่ผ่าน`);
  process.exit(1);
}
