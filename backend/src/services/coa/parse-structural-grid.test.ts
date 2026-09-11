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
check("evaluates to 0 SKIP", nSkip === 0, `got ${nSkip}`);
// เกณฑ์เป็นตัวเลข (Max 1) แต่ใบเขียนผลเป็นคำ "Traces" → ระบบยืนยันว่าผ่านไม่ได้ = ไม่ผ่าน
check("evaluates to 1 FAIL (Traces row)", nFail === 1, `got ${nFail}`);
check("+100/Traces row is the FAIL", ev[0].status === "FAIL" && ev[0].name === "Sieve Analysis +100");
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

// ── 5) PR1950W-4064: bare spec=0 ใน upper-bound column → specMax=0 → result=0 → PASS ──
//   fixture จาก _last-ocr-grid.txt ไฟล์จริง (text-layer) — แถว sieve(1mm) spec="0" result="0"
//   คอลัมน์ spec มี ≦1.2/≦5.0/≦0.10 (upper-bound 3 แถว) → specDir=upper → bare 0 → specMax:0
console.log("[5] PR1950W-4064 bare-0 spec in upper-bound column → PASS");
const PR4064 = [
  "Item |  | Unit | Treatment Condition | Specification | Test result",
  "Appearance |  | - | A | Powder without foreign body | GOOD",
  "Softening point |  | ℃ | A | 105〜115 | 113",
  "Flow |  | mm | 125ﾟC | 10〜35 | 15",
  "Gelation time |  | sec | A | 30〜55 | 35",
  "Moisture |  | ％ | A | ≦1.2 | 0.5",
  "Residue on sieve(106μm) |  | ％ | A | ≦5.0 | 1.3",
  "Residue on sieve(500μm) |  | ％ | A | ≦0.10 | 0.01",
  "Residue on sieve(1mm) |  | ％ | A | 0 | 0",
].join("\n");
const p4 = parseStructuralGrid(PR4064, "normal");
const sieve1mm = p4.items.find((it) => it.name === "Residue on sieve(1mm)");
check("sieve(1mm) emitted", !!sieve1mm, `items=${p4.items.map((i) => i.name).join(", ")}`);
check(
  "sieve(1mm) specMax=0 (bare-0 gated to upper-bound col)",
  sieve1mm?.specMax === 0 && sieve1mm?.specMin == null && sieve1mm?.specRaw == null,
  `specMax=${sieve1mm?.specMax} specMin=${sieve1mm?.specMin} specRaw=${sieve1mm?.specRaw}`
);
check("sieve(1mm) result='0'", sieve1mm?.result === "0", `got ${sieve1mm?.result}`);
const sieve1mmEval = sieve1mm ? evaluateItem(sieve1mm) : null;
check(
  "sieve(1mm) 0 ≤ 0 → PASS",
  sieve1mmEval?.status === "PASS",
  `status=${sieve1mmEval?.status} reason=${sieve1mmEval?.reason}`
);
// sentinel: แถวอื่นต้องไม่ถูกกระทบ (Softening point ยัง PASS ด้วย between 105~115)
const spEval = evaluateItem(p4.items.find((it) => it.name === "Softening point")!);
check("Softening point unaffected → PASS 105~115 result=113", spEval.status === "PASS");
// sentinel: AMBIG ยัง abstain (specDir=mixed ไม่มี spec cell เลย → ไม่ activate fallback)
const amEval2 = parseStructuralGrid(AMBIG, "normal").items.map(evaluateItem);
check(
  "[AMBIG still abstains after change]",
  amEval2.every((e) => e.status !== "PASS"),
  `statuses=${amEval2.map((e) => e.status).join(",")}`
);

console.log("\n[6] KGP-H65 merged-group layout → ป้ายแยกแถว (D50/D90) ต้องเข้าไปอยู่ในชื่อ");
// ใบจริง 関西マテック 試験成績表: col0 = ชื่อกลุ่ม merged, col1 = ตัวแยกแถว, col4 = 合否判定 (ค่าเดียวซ้ำ)
const KGP = [
  "試 験 項 目 |  | 規格値 | 実測値 | 合否判定 | 備考",
  "粒度(μm) | D50 | 6.5±1.0 | 6.5 | 合格 | レーザー回折散乱式測定 測定機器：LMS-30",
  " | D90 | 50以下 | 29.0 | 合格 | ",
  " | D50 | 13.0±3.0 | 13.3 | 合格 | レーザー回折散乱式測定 測定機器：S3500",
  " | D90 | 70以下 | 62.0 | 合格 | ",
  "嵩密度 | g/ml | 0.23±0.06 | 0.23 | 合格 | JIS K-3362",
  "化学成分(%) | SiO2+CaO | 94以上 | 96.85 | 合格 | 蛍光X線装置",
  " | Fe2O3 | 0.5以下 | 0.40 | 合格 | ",
].join("\n");
const kgp = parseStructuralGrid(KGP, "normal");
const kgpNames = kgp.items.map((i) => i.name);
// 7 แถว · ทุกชื่อมีป้ายต่อท้าย ไม่เหลือ "粒度(μm)" เปล่า ๆ ที่แยกแถวไม่ออก
//   (D50/D90 ซ้ำคู่ได้จริง — ใบนี้วัด 2 เครื่อง LMS-30 / S3500 คนละ spec 6.5±1.0 vs 13.0±3.0)
check(
  "7 แถว ทุกชื่อมีป้ายแยก (ไม่มีชื่อกลุ่มเปล่า)",
  kgp.items.length === 7 && !kgpNames.some((n) => n === "粒度(μm)" || n === "化学成分(%)"),
  `names=${kgpNames.join(" | ")}`
);
check("粒度(μm) D50 ตัวแรก", kgpNames[0] === "粒度(μm) D50", `got ${kgpNames[0]}`);
check("แถว merged สืบชื่อกลุ่ม → 粒度(μm) D90", kgpNames[1] === "粒度(μm) D90", `got ${kgpNames[1]}`);
check("化学成分(%) Fe2O3", kgpNames[6] === "化学成分(%) Fe2O3", `got ${kgpNames[6]}`);
check("嵩密度 g/ml", kgpNames[4] === "嵩密度 g/ml", `got ${kgpNames[4]}`);
// 合否判定 ("合格" ซ้ำทุกแถว = distinct 1) ต้องไม่ถูกเลือกเป็นป้าย
check("ไม่ดูด 合格 (judgement) เข้าชื่อ", !kgpNames.some((n) => n.includes("合格")), kgpNames.join(" | "));
const kgpEval = kgp.items.map(evaluateItem);
check(
  "7 แถว PASS หมด (ตรงกับ 合格 ในใบจริง)",
  kgpEval.every((e) => e.status === "PASS"),
  kgpEval.map((e) => `${e.name}=${e.status}`).join(", ")
);
// 以上/以下 = ทิศกลับกัน อ่านผิดทิศเมื่อไหร่ PASS พลิกเป็น FAIL ทันที
const sio2 = kgp.items.find((i) => i.name.includes("SiO2"));
check("94以上 → specMin (ไม่ใช่ max)", sio2?.specMin === 94 && sio2?.specMax == null, `min=${sio2?.specMin} max=${sio2?.specMax}`);
const fe = kgp.items.find((i) => i.name.includes("Fe2O3"));
check("0.5以下 → specMax (ไม่ใช่ min)", fe?.specMax === 0.5 && fe?.specMin == null, `min=${fe?.specMin} max=${fe?.specMax}`);

// ★ regression ★ grid จริงของ PR1950W_4064 มีบรรทัด metadata บนหัวตารางที่ col0 ว่าง (ไม่ใช่ merged group)
//   เคยทำให้ป้าย activate → ชื่อกลายเป็น "Softening point ℃" และ header "Item" → "Item Unit"
//   ซึ่งรอด metadata-filter (`^item$`) ไปโผล่เป็น SKIP ปลอม
const PR4064_REAL = [
  "Certificate of Compliance Shimodate Plant Quality Assurance Dept. |  |  |  |  |  | ",
  " | No. 4 0 6 4-08 Date Apr./06/2026 |  |  |  |  | ",
  "Item |  | Unit | Treatment Condition | Specification | Test result | ",
  "Appearance |  | - | A | Powder without foreign body | GOOD | ",
  "Softening point |  | ℃ | A | 105〜115 | 113 | ",
  "Flow |  | mm | 125ﾟC | 10〜35 | 15 | ",
  "Moisture |  | ％ | A | ≦1.2 | 0.5 | ",
].join("\n");
const pr = parseStructuralGrid(PR4064_REAL, "normal").items.map((i) => i.name);
check(
  "[regression] metadata row ที่ col0 ว่าง ไม่นับเป็น merged group",
  !pr.some((n) => /℃|mm|％|Unit/.test(n)),
  pr.join(" | ")
);
check(
  "[regression] header 'Item' ไม่ถูกต่อป้าย (metadata-filter ต้องยังตัดได้)",
  !pr.some((n) => /^Item\s/.test(n)),
  pr.join(" | ")
);

// sentinel: col0 ครบทุกแถว (ไม่มี merged) → ห้าม activate ป้าย แม้จะมีคอลัมน์ text ว่าง ๆ อยู่
const NO_MERGE = [
  "Item | Unit | Specification | Test result",
  "Softening point | ℃ | 105〜115 | 113",
  "Flow | mm | 10〜35 | 15",
  "Gelation time | sec | 30〜55 | 35",
].join("\n");
const nm = parseStructuralGrid(NO_MERGE, "normal").items.map((i) => i.name);
check(
  "[sentinel] ไม่มี merged cell → ชื่อไม่ถูกต่อท้าย",
  nm.every((n) => !/℃|mm|sec/.test(n)),
  nm.join(" | ")
);

// ★ regression ★ scanned-vector สร้าง cell จาก token OCR ที่เลื่อนได้ → ห้ามต่อป้าย
//   (PR1950W_4063 เคยได้ "Softening point 125℃ mm" ทั้งที่แถวนั้นคือ Flow)
const kgpScanned = parseStructuralGrid(KGP, "normal", "scanned-vector").items.map((i) => i.name);
check(
  "[regression] scanned-vector → ไม่ต่อป้าย (cell เชื่อไม่ได้)",
  kgpScanned.every((n) => !/D50|D90|Fe2O3|SiO2/.test(n)),
  kgpScanned.join(" | ")
);
check(
  "structural → ต่อป้าย (เทียบกับบรรทัดบน = ต่างกันจริง)",
  parseStructuralGrid(KGP, "normal", "structural").items[0].name === "粒度(μm) D50"
);

// ★ regression ★ PR1950W_4063 p2 ตัวจริง — เส้นเวกเตอร์เหลื่อมกับภาพสแกน ทำให้ชื่อสั้น (Appearance/Flow/
//   Moisture) หลุดคอลัมน์ไปเลย เหลือ col0 ว่าง. scanned-vector ห้ามยืมชื่อแถวบนมาเติม ไม่งั้นได้
//   "Softening point" 2 แถว (ตัวที่ 2 ที่จริงคือ Flow) ซึ่งค่าถูก/ชื่อผิด = ผิดรายการเวลาส่งเข้าระบบ QC
const SHIFTED_4063_P2 = [
  "Item | Unit | Treatment Condition | Specification | Test result",
  " | A - |  | Powderwithoutforeign body | GOOD",
  "Softening point | °℃ A |  | 105~115 | 112",
  " | 125℃ mm |  | 10~35 | 16",
  "Gelation time | A sec |  | 30~55 | 41",
  " | % A |  | ≤1.2 | 0.2",
  "Residue on sieve(106 μ m) | % A |  | ≤5.0 | 1.4",
].join("\n");
const shiftedNames = parseStructuralGrid(SHIFTED_4063_P2, "normal", "scanned-vector").items.map(
  (i) => i.name
);
check(
  "[regression] scanned-vector ชื่อหาย → ไม่ยืมชื่อแถวบน (ไม่มีชื่อซ้ำ)",
  new Set(shiftedNames).size === shiftedNames.length,
  shiftedNames.join(" | ")
);
check(
  "[regression] scanned-vector ชื่อหาย → แถวนั้นหายไปเลย ไม่ใช่ชื่อผิด",
  !shiftedNames.some((n) => /^Softening point$/.test(n) && shiftedNames.filter((x) => x === n).length > 1) &&
    shiftedNames.length === 3,
  `${shiftedNames.length} rows: ${shiftedNames.join(" | ")}`
);
// structural (เส้นตารางจริง) ยังยืมชื่อได้ตามเดิม — carry มีไว้รองรับ mesh row ใต้ชื่อกลุ่ม
const carried = parseStructuralGrid(SHIFTED_4063_P2, "normal", "structural").items.map((i) => i.name);
check(
  "structural → ยังยืมชื่อแถวบนได้ (พฤติกรรมเดิม)",
  carried.filter((n) => n.startsWith("Softening point")).length === 2,
  carried.join(" | ")
);

// ── 7) 2 ล็อตเป็นคอลัมน์ค่าผล (Suzorite 325-HK ใบจริง) → ต้องออกแถวทั้ง 2 ล็อต ป้ายล็อตอยู่ในชื่อ ──
//   เดิมหยิบคอลัมน์ขวาสุดคอลัมน์เดียว แล้วหัวรายงานแปะ lot=850993 ทั้งที่ค่าเป็นของ 850997 = ป้ายผิดล็อต
console.log("[7] 2 lot columns → emit ทุกล็อต");
const TWO_LOTS = [
  "Item | Method | Specifications |  |  | LOT NO. 850993 | LOT NO. 850997",
  "Sieve Analysis | ASTM E 11-87/ ASTM C 136-84 | (Mesh, wt%) | +100 | Max 1 | Traces | Traces",
  " |  |  | -100/＋200 | Max 5 | 1.50 | 0.90",
  " |  |  | -200/＋325 | 1〜8 | 6.00 | 3.65",
  " |  |  | -325 | 92〜100 | 92.50 | 95.45",
  "Loose Bulk Density | ASTM D716-86 | （lb/cu-ft） | 11.0〜16.0 |  | 11.4 | 12.2",
  "Humidity | ASTM D 1864-81 | (％) | 0.00〜0.70 |  | 0.23 | 0.26",
].join("\n");
const two = parseStructuralGrid(TWO_LOTS, "transposed");
check("12 แถว (6 รายการ × 2 ล็อต)", two.items.length === 12, `got ${two.items.length}`);
const twoNames = two.items.map((i) => i.name);
check(
  "ชื่อแถวมีป้ายล็อตของตัวเอง",
  twoNames[0] === "LOT No.850993 Sieve Analysis +100" &&
    twoNames[6] === "LOT No.850997 Sieve Analysis +100",
  twoNames.join(" | ")
);
const twoEval = two.items.map(evaluateItem);
check(
  "ค่าของล็อตแรกมาจากคอลัมน์ล็อตแรก (Humidity 0.23)",
  twoEval[5].result === 0.23 && twoEval[11].result === 0.26,
  `${twoEval[5].result} / ${twoEval[11].result}`
);
check(
  "10 PASS / 0 SKIP / 2 FAIL (Traces ของทั้ง 2 ล็อต — เกณฑ์ตัวเลขเทียบคำไม่ได้)",
  twoEval.filter((e) => e.status === "PASS").length === 10 &&
    twoEval.filter((e) => e.status === "SKIP").length === 0 &&
    twoEval.filter((e) => e.status === "FAIL").length === 2,
  twoEval.map((e) => e.status).join(",")
);
check("ไม่ประกาศเลขล็อตที่หัวรายงาน (ค่ามาจาก 2 ล็อต)", two.lotNo === null, `got ${two.lotNo}`);

// ★ reviewer ROUND 34 ★ คอลัมน์ล็อตอยู่ "ซ้าย" ของคอลัมน์เกณฑ์ + ค่าผลของล็อตเป็นทรงขอบ ("<0.010")
//   ถ้า loop หาเกณฑ์ไม่ข้ามคอลัมน์ล็อตอื่น → ค่าของล็อต B กลายเป็นเกณฑ์ของแถวล็อต A = เทียบค่ากับค่า
const LOTS_BEFORE_SPEC = [
  "Item | LOT NO. A1 | LOT NO. B2 | Specifications",
  "S-Fe2O3 | <0.010 | <0.012 | 0.020 Max",
  "Moisture | 0.30 | 0.40 | 0.50 Max",
].join("\n");
const lb = parseStructuralGrid(LOTS_BEFORE_SPEC, "normal");
check("6 แถว (3 รายการ? ไม่ — 2 รายการ × 2 ล็อต)", lb.items.length === 4, `got ${lb.items.length}`);
const feRows = lb.items.filter((i) => String(i.name).includes("S-Fe2O3"));
check(
  "เกณฑ์ทุกล็อตมาจากคอลัมน์ Specifications (0.020) ไม่ใช่ค่าของล็อตข้างๆ",
  feRows.length === 2 && feRows.every((i) => i.specMax === 0.02),
  feRows.map((i) => `${i.name}: max=${i.specMax} raw=${i.specRaw}`).join(" | ")
);
check(
  "ค่าผลของแต่ละล็อตยังเป็นของตัวเอง",
  feRows[0]?.result === "<0.010" && feRows[1]?.result === "<0.012",
  `${feRows[0]?.result} / ${feRows[1]?.result}`
);
// scanned-vector = cell เลื่อนได้ → ห้ามแตกหลายล็อต (ค่าข้ามล็อตได้)
const scannedTwo = parseStructuralGrid(TWO_LOTS, "transposed", "scanned-vector");
check(
  "[gate] scanned-vector → ไม่แตกหลายล็อต (6 แถว ไม่มีป้ายล็อต)",
  scannedTwo.items.length === 6 && !scannedTwo.items.some((i) => /^LOT No\./.test(String(i.name))),
  `${scannedTwo.items.length} rows`
);

// sentinel: ล็อตเดียว → พฤติกรรมเดิมเป๊ะ (ไม่ต่อป้ายล็อต ไม่เพิ่มแถว)
check(
  "[sentinel] ล็อตเดียว → ชื่อไม่มีป้ายล็อต 6 แถวเท่าเดิม",
  sz.items.length === 6 && !sz.items.some((i) => /^LOT No\./.test(String(i.name))),
  sz.items.map((i) => i.name).join(" | ")
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
