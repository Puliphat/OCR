// ★ ที่เดียวของกติกา "อ่านตัวเลขจากใบ COA" ★ — separator + ความกำกวมหลักพัน
//   เดิม toNum + pattern ถูก copy ไว้ทั้ง spec-normalizer และ result-normalizer → แก้ที่เดียวลืมอีกที่

// 1 token ตัวเลข — ตัวคั่นได้หลายกลุ่ม (`*` ไม่ใช่ `?`)
//   `?` เดิมตัด "1,494.80" เป็น ["1,494", "80"] แล้วเฉลี่ยเป็น 40.747 = ค่าผิดเงียบ ๆ
export const NUM_PATTERN = String.raw`-?\d+(?:[.,]\d+)*`;

// ตัวคั่นช่วง/ค่าเผื่อ — ★ ต้อง match ด้วย regex ที่บังคับมีตัวคั่นเสมอ ★
//   ไล่เก็บเลขทีละตัวจะอ่าน "8.00-11.00" เป็น [8, -11]

// spec-normalizer.ts ยังมี copy ของ 3 ตัวล่างนี้เอง (ใช้กับข้อความที่ strip หน่วยแล้ว)
//   แก้กติกาตัวคั่นต้องไล่แก้ทั้งสองที่ จนกว่าจะรวมได้
export const RANGE_SEP = String.raw`[~\-–—]`;
export const TOLERANCE_SEP = String.raw`(?:±|\+/-|\+-)`;
// ตัวคั่นช่วงแบบเต็มความกว้างของใบญี่ปุ่น/จีน — ทำให้เป็น "~" ก่อนเทียบทุกครั้ง
export const normalizeTilde = (s: string): string => s.replace(/[～〜∼]/g, "~");

// EU decimal vs US thousands: มี comma แต่ไม่มี period → comma คือทศนิยม (0,28 → 0.28)
//   มีทั้งคู่ → comma คือหลักพัน strip ทิ้ง (1,000.5 → 1000.5)
export function toNum(s: string): number {
  const t = s.trim();
  return Number(
    t.includes(",") && !t.includes(".") ? t.replace(/,/g, ".") : t.replace(/,/g, "")
  );
}

// ★ token กำกวม ★ — "1,500" อ่านได้ 2 ทาง: EU 1.5 หรือ US 1500 (toNum เลือก EU เสมอ)
//   มี "." ด้วย (1,494.80) = หลักพันชัดเจน · 2 หลัก (200,00) = ทศนิยมชัด · 4 หลัก (07,2026) = วันที่
const AMBIGUOUS_TOKEN = /^-?\d{1,3}(?:,\d{3})+$/;
// ปลอดภัยที่จะ share ตัวเดียว: ทั้ง .match และ .replace แบบ /g รีเซ็ต lastIndex ให้เอง
const NUM_TOKENS = new RegExp(NUM_PATTERN, "g");

const isAmbiguous = (tok: string): boolean =>
  !tok.includes(".") && AMBIGUOUS_TOKEN.test(tok);

const numTokens = (v: unknown): string[] =>
  v == null || typeof v === "number" ? [] : String(v).match(NUM_TOKENS) ?? [];

// ★ กติกาเลือกสเกลข้อเดียวที่ใช้ทั้งไฟล์ ★ — คู่แข่งคือ eu (ค่าที่ toNum อ่านได้) กับ us = eu×1000
//   เทียบระยะใน log-space:  |log(anchor/eu)| < |log(us/anchor)|  ⟺  anchor² < eu·us  (ไม่ต้องเรียก Math.log)
//   ★ ไม่ใช่ "เลือกอันที่ PASS" ★ — ค่าที่หลุดเกณฑ์จริงยังได้ FAIL พร้อมเลขที่ถูกสเกล
export function pickScale(eu: number, anchor: number): "eu" | "us" {
  return anchor * anchor > eu * eu * 1000 ? "us" : "eu";
}

// magnitude ตัวแทนของเลข "ที่ไม่กำกวม" ในกลุ่มเดียวกัน — geometric mean ของตัวเล็กสุด/ใหญ่สุด
//   (อยู่ใน log-space เดียวกับ pickScale) · ตัด 0 ทิ้ง ("0~2" ต้องได้ 2 ไม่ใช่ 0) · ไม่มีเลย = null
export function siblingMagnitude(...vals: unknown[]): number | null {
  const clean = vals
    .flatMap(numTokens)
    .filter((t) => !isAmbiguous(t))
    .map((t) => Math.abs(toNum(t)))
    .filter((n) => Number.isFinite(n) && n !== 0);
  if (clean.length === 0) return null;
  return Math.sqrt(Math.min(...clean) * Math.max(...clean));
}

// ★ นับเฉพาะกำกวมที่ตัดสินไม่ได้ ★ — เลขอื่นในกลุ่มพินสเกลได้แล้ว = จบ (เช่น "0.920~1,420": 0.920 ยืนยัน 1,420 = 1.42)
//   anchor มาจากกลุ่มตัวเอง (เกณฑ์พินเกณฑ์ · ค่าผลพินค่าผล) ไม่ยืมข้ามฝั่ง — ยืมข้ามจะทำของหลุดเกณฑ์กลายเป็น PASS ปลอม
//   anchor ชี้ว่าควรอ่านแบบหลักพัน = ค่าที่อ่านอยู่ผิด 1000 เท่า → ยังกำกวม ไม่แก้เงียบให้คนดูแทน
export function hasUnpinnedAmbiguity(...vals: unknown[]): boolean {
  const ambiguous = vals.flatMap(numTokens).filter(isAmbiguous);
  if (ambiguous.length === 0) return false;
  const anchor = siblingMagnitude(...vals);
  return anchor == null || ambiguous.some((t) => pickScale(toNum(t), anchor) !== "eu");
}

// อ่าน token กำกวมใหม่เป็นหลักพัน ("1,500" → "1500") แล้วส่งกลับให้ pipeline เดิม parse ต่อ
//   (เขียนทับ input string ไม่ใช่แก้ค่าปลายทาง → ไม่มี code path ขนานให้หลุด sync)
export function readAsThousands<T>(v: T): T {
  if (typeof v !== "string") return v;
  return v.replace(NUM_TOKENS, (tok) =>
    isAmbiguous(tok) ? tok.replace(/,/g, "") : tok
  ) as T;
}
