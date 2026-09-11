// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node spec-cell-equality.test.ts
// ด่านที่คุม: ค่าผลเท่าเกณฑ์เป๊ะจะเขียวได้เฉพาะแถวที่พิสูจน์ได้ว่าเกณฑ์มาจากช่องบนใบ (specFromCell)
import { evaluateItem, evaluateCoa } from "./coa-evaluator";

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// 1. Copper Fiber "1400μm on" — เกณฑ์ "(0)" ในวงเล็บบนใบ ผลวัดได้ 0 → ผ่านทุกทิศ
{
  const r = evaluateItem({ name: "1400μm on", specRaw: "0", result: 0, specFromCell: true });
  check("เกณฑ์ 0 จากช่องบนใบ + ผล 0 → PASS", r.status, "PASS");
  // เกณฑ์ 0 ผล 0 ผ่านเหมือนกันทุกทิศ (≤/≥/=) → ธงบอกอะไรไม่ได้ (user decision 2026-09-11)
  check("ไม่ต้องปักธง", r.needsReview, false);
}

// 2. ★ ตัวแยกของจริง ★ FC-250-1500 ไม่มีคอลัมน์เกณฑ์ — LLM คัดลอกค่าผลมาเป็นเกณฑ์ → ต้อง SKIP ต่อ
{
  const r = evaluateItem({ name: "Ash (810°C)", specRaw: "0.07", result: 0.07 });
  check("เกณฑ์เลขเปล่าไม่มีที่มา + ผลเท่ากัน → SKIP", r.status, "SKIP");
}

// 3. NYGLOS8 "Air Jet Sieve +50M" — เกณฑ์ 0~0 จากคอลัมน์ Lower/Upper limit ผล 0
{
  const r = evaluateItem({ name: "Air Jet Sieve +50M", specRaw: "0~0", result: 0, specFromCell: true });
  check("เกณฑ์ 0~0 จากช่องบนใบ + ผล 0 → PASS", r.status, "PASS");
  check("ไม่ต้องปักธง", r.needsReview, false);
}

// 4. VERMICULITE แถว total — เกณฑ์บนใบเขียน "100%" ผลรวม 100
{
  const r = evaluateItem({ name: "total", specRaw: "100%", result: 100, specFromCell: true });
  check("เกณฑ์ 100% + ผล 100 → PASS", r.status, "PASS");
  // แถว total คือตัวเช็คยอดรวม — ผลเท่าเกณฑ์เป๊ะ ผ่านทุกทิศที่เป็นไปได้ ธงบอกอะไรไม่ได้ (user 2026-09-11)
  check("เท่าเกณฑ์เป๊ะ ไม่ปักธง", r.needsReview, false);
}

// 5. ขอบช่วงปกติไม่เกี่ยวกับด่านนี้ — Kemolit BulkDensity 0.45~0.50 ผล 0.50 ยัง SKIP เหมือนเดิม
{
  const r = evaluateItem({
    name: "BulkDensity(Loose)",
    specRaw: "0.45~0.50",
    result: 0.5,
    specFromCell: true,
  });
  check("ค่าตรงขอบช่วง (min≠max) → SKIP ตามเดิม", r.status, "SKIP");
}

// 6. เกณฑ์จากช่องบนใบแต่ค่าไม่เท่ากัน → ทิศยังไม่รู้ ห้ามตัดสิน
{
  const r = evaluateItem({ name: "-325", specRaw: "95", result: 92.5, specFromCell: true });
  check("เลขเปล่าทิศไม่รู้ + ค่าไม่เท่า → SKIP", r.status, "SKIP");
}

// 7. Kemolit "Retention on 60 mesh" — ใบพิมพ์ "<0.0" เอง ไม่มีค่าใดผ่านได้ → SKIP ไม่ใช่ FAIL
{
  const r = evaluateItem({ name: "Retention on 60 mesh", specRaw: "<0.0", result: 0 });
  check("เกณฑ์ <0.0 + ผล 0 → SKIP", r.status, "SKIP");
  check("เหตุผลอ้างเกณฑ์ที่พิมพ์บนใบ", /<0\.0/.test(r.reason), true);
}

// 8. ขอบ strict ปกติต้องยัง FAIL ได้ — ด่าน unsatisfiable ห้ามกลืน FAIL จริง
{
  const r = evaluateItem({ name: "Moisture", specRaw: "<5", result: 7 });
  check("เกณฑ์ <5 + ผล 7 → FAIL", r.status, "FAIL");
}

// 8b. เกณฑ์ติดลบ "มี" ค่าที่ผ่านได้ (-6 ผ่าน <-5) → ของเสียจริงต้องยังเป็น FAIL ไม่ใช่ SKIP
{
  const r = evaluateItem({ name: "Delta", specRaw: "<-5", result: 3 });
  check("เกณฑ์ <-5 + ผล 3 → FAIL", r.status, "FAIL");
}

// 9. ด่านระดับใบ (suppressCopiedSpec) ยังทำงาน: ทุกแถว spec=result และไม่มีที่มา → SKIP ทั้งใบ
{
  const rep = evaluateCoa({
    filename: "FC-250-1500.pdf",
    items: [
      { name: "Ash", specRaw: "0.07", result: 0.07 },
      { name: "Moisture", specRaw: "0.15", result: 0.15 },
      { name: "S (ELTRA)", specRaw: "1.1", result: 1.1 },
      { name: "App_Vol", specRaw: "134", result: 134 },
    ],
  });
  check("ใบไม่มีคอลัมน์เกณฑ์ → 0 PASS", rep.summary.pass, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
