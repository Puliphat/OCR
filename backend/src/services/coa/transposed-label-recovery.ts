// ตารางที่รายการเรียงแนวนอน (TAIHEIYO CMF): ป้ายหน่วยนำหน้าบรรทัดค่า ทำให้ LLM จับคู่เลื่อน 1 ช่อง
//   — ชื่อ SiO2 ไปได้ค่าของ Al2O3. แตะเฉพาะแถวที่ไม่มีเกณฑ์ (SKIP ถาวร) จึงพลิก verdict ไม่ได้เลย
import { EvaluatedItem } from "./coa-evaluator";
import { splitCells, singleNumberCell } from "./column-shift-recovery";

export interface TransposedRealignResult {
  realigned: { name: string; from: string | null; to: string | null }[];
}

const MIN_COLS = 5; // ตารางแนวนอนจริงมีหลายคอลัมน์ — น้อยกว่านี้เสี่ยงจับบรรทัดมั่ว

function nameKey(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// คู่ (บรรทัดชื่อ, บรรทัดค่า) ที่จำนวนช่องเท่ากัน — ค่าต้องเป็นเลขล้วนตั้งแต่ช่องที่ 2 เป็นต้นไป
function findHeaderValuePairs(ocrText: string): { names: string[]; values: string[] }[] {
  const lines = ocrText.split(/\r?\n/);
  const pairs: { names: string[]; values: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const names = splitCells(lines[i]);
    if (names.length < MIN_COLS) continue;
    if (names.some((c) => singleNumberCell(c) !== null)) continue; // บรรทัดชื่อต้องไม่มีเลขเดี่ยว
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      const values = splitCells(lines[j]);
      if (values.length !== names.length) continue;
      if (values.slice(1).some((c) => singleNumberCell(c) === null)) continue;
      pairs.push({ names, values });
      break;
    }
  }
  return pairs;
}

// แก้ result ของแถวที่ชื่อ/ค่าเลื่อนกันในตารางแนวนอน — คืนรายการแถวที่แก้
export function realignTransposedLabels(
  rows: EvaluatedItem[],
  ocrText: string
): TransposedRealignResult {
  const realigned: TransposedRealignResult["realigned"] = [];
  if (!rows?.length || !ocrText) return { realigned };

  // แถวที่ไม่มีเกณฑ์จริง: ไม่มี min/max เลย หรือ min=max (เกณฑ์ที่ LLM copy มาจากค่าผล) — ทั้งคู่เป็น SKIP อยู่แล้ว
  const targets = rows.filter(
    (r) => r.status === "SKIP" && (r.min == null || r.min === r.max)
  );
  if (targets.length < 3) return { realigned };

  for (const { names, values } of findHeaderValuePairs(ocrText)) {
    const byName = new Map<string, number>();
    names.forEach((n, idx) => {
      const k = nameKey(n);
      if (k) byName.set(k, byName.has(k) ? -1 : idx); // ชื่อซ้ำ = กำกวม ไม่ใช้
    });

    // ★ แตะเมื่อพิสูจน์ได้ว่าค่าทุกตัวมาจากบรรทัดค่าเดียวกันนี้ ★ — ค่าของแต่ละแถวต้องตรงช่องตัวเอง
    //   หรือช่องถัดไป (เลื่อน 1) รวมกัน ≥60% ถ้าต่ำกว่านั้นแปลว่าจับคู่ผิดตาราง → ปล่อยไว้ ดีกว่าทับผิด
    let matched = 0;
    let aligned = 0;
    let shifted = 0;
    for (const r of targets) {
      const idx = byName.get(nameKey(r.name));
      if (idx == null || idx < 0) continue;
      matched++;
      const own = singleNumberCell(values[idx] ?? "");
      const left = idx + 1 < values.length ? singleNumberCell(values[idx + 1] ?? "") : null;
      const res = typeof r.result === "number" ? r.result : Number(r.result);
      if (!Number.isFinite(res)) continue;
      if (own !== null && Math.abs(own - res) < 1e-9) aligned++;
      else if (left !== null && Math.abs(left - res) < 1e-9) shifted++;
    }
    if (matched < 4 || shifted === 0 || (aligned + shifted) / matched < 0.6) continue;

    for (const r of targets) {
      const idx = byName.get(nameKey(r.name));
      if (idx == null || idx < 0) continue;
      const own = singleNumberCell(values[idx] ?? "");
      const before = r.resultRaw;
      if (own === null) {
        if (r.result == null && r.resultRaw == null) continue;
        r.result = null;
        r.resultRaw = null;
      } else {
        if (r.result === own) continue;
        r.result = own;
        r.resultRaw = values[idx].replace(/\s+/g, "");
      }
      // เกณฑ์ที่ LLM copy มาจากค่าผลเดิม ไม่ใช่เกณฑ์บนใบ — ล้างทิ้งไม่ให้ค้างคู่กับค่าใหม่
      if (r.min != null && r.min === r.max) {
        r.min = null;
        r.max = null;
        r.specRaw = null;
        r.reason = "ใบนี้ไม่มีคอลัมน์เกณฑ์ — ต้องตั้ง spec เอง";
      }
      r.needsReview = true;
      realigned.push({ name: r.name, from: before, to: r.resultRaw });
    }
  }
  return { realigned };
}
