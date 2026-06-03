// ★ Header-anchored single-bound direction classifier ★ (text-layer only, post-LLM, geometry-based)
//
// ปัญหาที่แก้ (เคสจริง Barimite200): ตาราง spec มี header "Min. Spec. | Max. Spec. | Actual Results"
//   แต่หลายแถวพิมพ์ bound เดียว (เช่น Moisture "0.20" ใต้คอลัมน์ Max, D50 "11.0" ใต้ Max, 325Mesh "95" ใต้ Min).
//   พอ flatten เป็น text บรรทัด ทิศ (Min/Max) หาย → spec-normalizer เห็นเลขเปล่า → op=eq →
//   symmetric bare-eq guard ส่ง SKIP หมด (เสีย verdict ที่จริงๆ รู้ได้) หรือก่อนหน้านี้ = FAIL ปลอม
//
// ★ ทำไมปลอดภัย (ต่างจาก lever-1 ที่ revert) ★
//   1. ทำงานบน "geometry ดิบ" (token X) ที่ extractPdfText คำนวณแล้วทิ้ง — ★ ไม่แตะ flat text ที่ LLM เห็นเลย ★
//      4b อ่าน Z99/TR_1099/Inolob/TXAX เหมือนเดิมเป๊ะ (lever-1 พังเพราะ restructure text ที่ป้อน LLM)
//   2. คืนเป็น "hint" ให้ corrector ใช้เฉพาะ row ที่ LLM ให้ op=eq (bound เดียว) — ★ range row ไม่แตะ ★
//      (TR_1099 ที่ lever-1 พัง เป็น range → ไม่เข้า eq → ปลอดภัยโดยโครงสร้าง)
//   3. classify เฉพาะเมื่อ header Min/Max เจอจริง + bound X ชัดว่าใกล้ฝั่งไหน → ไม่ชัด/ไม่เจอ = ไม่ emit (คง SKIP เดิม)
//      → upgrade SKIP→verdict ได้อย่างเดียว ไม่มีทาง flip PASS/FAIL ที่ถูกอยู่แล้ว
import * as fs from "fs";
import * as path from "path";

const pdfjsDistPath = path.dirname(require.resolve("pdfjs-dist/package.json"));

export interface DirectionHint {
  name: string; // ชื่อ row (token ตัวอักษรก่อน spec) lower-case
  value: number; // ค่า bound
  direction: "min" | "max"; // ge (Min) หรือ le (Max)
}

interface RawTok { str: string; x: number; y: number; w: number }
interface NumCell { value: number; x: number } // เลขที่ merge แล้ว + X ซ้ายสุด

const isNumPart = (s: string) => /^[\d.,]+$/.test(s.trim());

// merge token เลขที่ติดกันในแถว → 1 number ต่อ cell (pdfjs split "11.0" เป็น "11"."."."0")
//   break เมื่อเจอ non-numeric (unit/%/letter) หรือ gap กว้าง (ข้าม cell)
function mergeNumbers(rowSorted: RawTok[]): NumCell[] {
  const out: NumCell[] = [];
  let acc = "";
  let accX = 0;
  let lastRight = -Infinity;
  const flush = () => {
    if (acc) {
      const v = Number(acc.replace(/,/g, "."));
      if (!Number.isNaN(v)) out.push({ value: v, x: accX });
    }
    acc = "";
  };
  for (const t of rowSorted) {
    const s = t.str.trim();
    if (isNumPart(s)) {
      const gap = t.x - lastRight;
      if (acc && gap > 25) flush(); // gap กว้าง = cell ใหม่
      if (!acc) accX = t.x;
      acc += s;
      lastRight = t.x + (t.w || 0);
    } else {
      flush();
      lastRight = t.x + (t.w || 0);
    }
  }
  flush();
  return out;
}

// token ตัวอักษร (ชื่อ row) ก่อน spec → string lower-case
function rowName(rowSorted: RawTok[]): string {
  return rowSorted
    .map((t) => t.str)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9μ.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// หา X ของ header word — คืน null ถ้าไม่เจอ
function findHeaderX(rowSorted: RawTok[], re: RegExp): number | null {
  for (const t of rowSorted) if (re.test(t.str)) return t.x;
  // เผื่อ header split ("Min."+"Spec.") — เช็ค joined ต่อ token ด้วย
  return null;
}

// อ่าน PDF → คืน hint ทิศของแถวที่มี "bound เดียวในโซน spec" ใต้ header Min/Max
// คืน [] ถ้าไม่เจอ header Min/Max (= ไม่ใช่ตารางแบบนี้ → ไม่ทำอะไร) — fail-safe
export async function extractHeaderDirectionHints(
  filePath: string
): Promise<DirectionHint[]> {
  if (path.extname(filePath).toLowerCase() !== ".pdf") return [];
  let doc: any;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(filePath));
    doc = await getDocument({
      data,
      cMapUrl: path.join(pdfjsDistPath, "cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: path.join(pdfjsDistPath, "standard_fonts/"),
      useSystemFonts: true,
    }).promise;
  } catch {
    return []; // อ่านไม่ได้ → ไม่มี hint (fail-safe, ตกไป SKIP เดิม)
  }

  const hints: DirectionHint[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const toks: RawTok[] = [];
      for (const it of tc.items as any[]) {
        if (!it.str || !it.str.trim()) continue;
        toks.push({
          str: it.str,
          x: it.transform[4],
          y: Math.round(it.transform[5]),
          w: typeof it.width === "number" ? it.width : 0,
        });
      }
      page.cleanup();
      if (!toks.length) continue;

      // group เป็นแถวตาม Y
      toks.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: RawTok[][] = [];
      let cur: RawTok[] = [toks[0]];
      let lastY = toks[0].y;
      for (let i = 1; i < toks.length; i++) {
        if (Math.abs(toks[i].y - lastY) > 2) {
          rows.push(cur);
          cur = [];
        }
        cur.push(toks[i]);
        lastY = toks[i].y;
      }
      if (cur.length) rows.push(cur);

      // หาแถว header ที่มีทั้ง Min-ish และ Max-ish + ดึง X ของแต่ละฝั่ง (+ result ถ้ามี)
      let minX: number | null = null;
      let maxX: number | null = null;
      let resultX: number | null = null;
      for (const row of rows) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        const joined = sorted.map((t) => t.str).join(" ").toLowerCase();
        const hasMin = /\bmin\b|lower/.test(joined);
        const hasMax = /\bmax\b|upper/.test(joined);
        if (hasMin && hasMax) {
          minX = findHeaderX(sorted, /min|lower/i);
          maxX = findHeaderX(sorted, /max|upper/i);
          resultX = findHeaderX(sorted, /result|actual|analysis|value/i);
          break; // ใช้ header แรกที่เจอ
        }
      }
      if (minX == null || maxX == null) continue; // ไม่ใช่ตาราง Min/Max → ข้าม

      const lo = Math.min(minX, maxX);
      const hi = Math.max(minX, maxX);
      const specMid = (lo + hi) / 2;

      // แต่ละแถว data: หาเลขในโซน spec (ซ้ายของ result) ที่มี "ตัวเดียว" → classify ทิศ
      for (const row of rows) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        const nums = mergeNumbers(sorted);
        if (!nums.length) continue;
        const colW = Math.max(20, hi - lo);
        // เลขในโซน spec = อยู่ "ขวาของ name zone" (กันเลขฝังในชื่อ เช่น "D 100" → 100) และ
        //   "ใกล้ Min/Max มากกว่าใกล้ result" (กัน result ปน)
        const leftBound = lo - colW; // ซ้ายสุดที่ยังนับเป็น spec (หนึ่ง column-width ก่อน Min)
        const specNums = nums.filter((n) => {
          if (n.x < leftBound) return false; // อยู่ใน name column (เช่น "100" ใน "D 100")
          if (resultX != null) {
            const dSpec = Math.min(Math.abs(n.x - lo), Math.abs(n.x - hi));
            const dRes = Math.abs(n.x - resultX);
            return dSpec < dRes;
          }
          return n.x <= hi + colW;
        });
        if (specNums.length !== 1) continue; // ต้อง bound เดียว (range = 2 → ปล่อยให้ LLM/normalizer จัด)

        const b = specNums[0];
        // classify: ใกล้ Min หรือ Max — ต้องชัด (อยู่คนละฝั่ง midpoint อย่างมั่นใจ)
        const dMin = Math.abs(b.x - minX);
        const dMax = Math.abs(b.x - maxX);
        if (Math.abs(dMin - dMax) < 8) continue; // กำกวม (อยู่กลาง) → ไม่ classify
        const direction: "min" | "max" = dMin < dMax ? "min" : "max";

        // ชื่อ row = token (อักษร/เลข) ที่อยู่ "ซ้ายของ spec bound" — รวมเลขฝังในชื่อ เช่น "D 100"
        //   (ใช้ specNums[0].x ไม่ใช่ nums[0].x: nums อาจรวมเลขในชื่อ ทำ boundary สั้นเกิน)
        const nameBoundary = specNums[0].x - 4;
        const nameToks = sorted.filter((t) => t.x < nameBoundary && /[a-z0-9]/i.test(t.str));
        const name = rowName(nameToks);
        if (name.replace(/[^a-z0-9]/g, "").length < 2) continue; // ชื่อสั้นเกิน → ข้าม
        void specMid;
        hints.push({ name, value: b.value, direction });
      }
    }
  } finally {
    try { await doc.destroy(); } catch { /* ignore */ }
  }
  return hints;
}
