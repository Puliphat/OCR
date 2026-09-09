// ดึง product/lot จากป้ายบนใบเอง — LLM ชอบหยิบชื่อลูกค้า/บริษัทมาเป็นชื่อสินค้า (TXAX ได้ "Resonac
// Materials (Thailand)"). ไม่มีป้ายบนใบ = คืน null ดีกว่าเดาผิด
export interface ProductLot {
  product: string | null;
  lotNo: string | null;
}

// ★ ป้ายสินค้าต้องตรงทั้งช่อง ★ — ใบมีหัวตาราง "Product Characteristics"/"PRODUCT INFORMATION" ที่ไม่ใช่ป้าย
// ใบ TIMREX มีทั้งสองป้าย: Product Description = รหัสบรรจุ · Prod.Commercial Desc. = ชื่อการค้าจริง
const PRODUCT_TOP = [/^prod\.?\s*commercial\s*desc\.?$/i];
const PRODUCT_STRONG = [
  /^trade\s*name$/i,
  /^product\s*name(?:\s*\/\s*grade)?$/i,
  /^name\s*of\s*(?:product|goods)$/i,
  /^product\s*desc(?:ription)?$/i,
  /^grade$/i,
  /^品\s*名$/,
  /^商品名$/,
];
// "Product" เดี่ยวๆ บางใบให้รหัสวัสดุ (Z99 = 130035346) — ยังดีกว่า "Type" ที่ใบ DuPont ใช้กับรุ่นย่อย
const PRODUCT_MEDIUM = [/^product$/i, /^material(?:\s*code)?$/i];
const PRODUCT_WEAK = [/^type$/i];

// lot ต่อท้ายป้ายในช่องเดียวกันได้ ("LOT NO. 850996") → เทียบแบบขึ้นต้น แล้วตัดส่วนที่ป้ายกินทิ้ง
const LOT_STRONG = [
  /^lot\s*(?:no|number|nr)\b\.?/i,
  /^lot$/i,
  /^lot\s*#$/i, // "Lot#" เดี่ยวเท่านั้น — RI-015 มี "Lot#01" เป็นหัวคอลัมน์ของแถวข้อมูล ไม่ใช่ป้าย
  /^batch\s*(?:no|number)\b\.?/i,
  /ロット番号/,
  /製造番号/,
];
const LOT_WEAK = [/^box\s*no\b\.?/i, /^batch$/i];

// ป้ายฝั่งลูกค้า/ผู้รับ — เจอคำพวกนี้ในป้ายเดียวกันแปลว่าค่าถัดไปเป็นของลูกค้า ไม่ใช่ของเรา
// (CIIR มีทั้ง "Customer Product Name:" และ "Product Name/Grade:" บนใบเดียวกัน)
const CUSTOMER_LABEL =
  /(customer|顧客|consignee|ship\s*-?\s*to|delivery\s*to|sold\s*to|messrs|納入先|得意先)/i;

// ค่าที่ไม่ใช่คำตอบ — ใบบอกเองว่าไม่มี หรือเป็นป้ายอีกอัน
const EMPTY_VALUE = /^(?:n\.?\/?a\.?|nil|none|-+|_+|[:：]*)$/i;
const LOOKS_LIKE_LABEL =
  /^(?:date|no\.?|number|unit|item|spec(?:ification)?|result|limit|qty|quantity|mass|weight|address|page|tel|fax)\b/i;
const DATE_VALUE = /^\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{2,4}$/;
// เลขวัดในตาราง (0.30 / 38.44) ไม่ใช่ lot — lot ที่มีจุดเป็นรหัสยาว (HG-PP = 080312.2)
const MEASUREMENT_VALUE = /^\d{1,3}[.,]\d+$/;
// lot บนใบเป็นรหัส ไม่ใช่ประโยค — กันค่าที่ OCR อ่านเละอย่าง "/V1109%" ของ 1F1710 หน้า 4
const LOT_SHAPE = /^[A-Za-z0-9][A-Za-z0-9\-_. /]*$/;
const MAX_LABEL_LEN = 30; // ประโยคยาวไม่ใช่ป้าย ("batch and in compliance with…" ของ RB220)

const ALL_LABELS = [
  ...PRODUCT_TOP, ...PRODUCT_STRONG, ...PRODUCT_MEDIUM, ...PRODUCT_WEAK, ...LOT_STRONG, ...LOT_WEAK,
];

const cellsOf = (line: string) => line.split("|").map((c) => c.trim());
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ตัดหมายเลขข้อและส่วนหลัง ":" ออก — "1. GRADE : SUZORITE…" ต้องเทียบได้กับ /^grade$/
const labelKey = (cell: string) =>
  norm(cell.split(/[:：]/)[0]).replace(/^\d+\s*[.)]\s*/, "");

// -1 = ไม่ใช่ป้ายนี้ · ≥0 = ความยาวที่ป้ายกิน (ใช้ตัดค่าที่ต่อท้ายในช่องเดียวกัน)
function matchLen(key: string, pats: RegExp[]): number {
  for (const p of pats) {
    const m = p.exec(key);
    if (m) return m.index + m[0].length;
  }
  return -1;
}

function cleanValue(raw: string): { value: string | null; explicitNone: boolean } {
  const v = norm(raw).replace(/^[-.:：]+\s*/, "").replace(/[,;/]\s*$/, "");
  if (EMPTY_VALUE.test(v)) return { value: null, explicitNone: v.length > 0 };
  // ค่าที่เป็นป้ายเสียเอง — สแกนที่ OCR ตก ":" ทำให้ "Lot No." หลุดมาเป็นค่าของป้ายข้างๆ ได้
  if (!v || /[:：]$/.test(v) || LOOKS_LIKE_LABEL.test(v) || matchLen(labelKey(v), ALL_LABELS) >= 0)
    return { value: null, explicitNone: false };
  return { value: v, explicitNone: false };
}

function validProduct(v: string): boolean {
  if (v.length > 60 || !/[A-Za-z぀-ヿ一-鿿]/.test(v)) return false;
  return !/^\d{5,}$/.test(v); // รหัสวัสดุล้วน ไม่ใช่ชื่อ
}

const validLot = (v: string) =>
  v.length >= 4 && v.length <= 30 && /\d/.test(v) && LOT_SHAPE.test(v) &&
  !DATE_VALUE.test(v) && !MEASUREMENT_VALUE.test(v);

// ค่าที่คู่กับป้าย: ท้ายช่องเดียวกัน ("LOT NO. 850996") → ช่องถัดไป → ช่องแรกของบรรทัดถัดไป
// (ใบญี่ปุ่นวาง "ロット番号 Lot No. :" บรรทัดหนึ่ง ค่าอยู่บรรทัดล่าง)
function valuesAfter(lines: string[][], li: number, ci: number, eaten: number, nextLine: boolean): string[] {
  const cell = lines[li][ci];
  const out: string[] = [];
  const tail =
    cell.split(/[:：]/).length > 1
      ? cell.split(/[:：]/).slice(1).join(":")
      : labelKey(cell).slice(eaten);
  if (tail.trim()) out.push(tail);
  for (const c of lines[li].slice(ci + 1)) out.push(c);
  // บรรทัดล่างอ่านได้เฉพาะช่องแรก จึงใช้ได้เฉพาะป้ายที่อยู่ช่องแรกด้วย — ป้ายคอลัมน์ขวาจะไปหยิบ
  // ค่าที่อยู่ใต้ป้ายอื่น (แถว "Lot No. | Name of Product" ให้ product = ชื่อลูกค้า)
  if (nextLine && ci === 0 && lines[li].length <= 3 && lines[li + 1]?.length) out.push(lines[li + 1][0]);
  return out;
}

// ป้ายที่ถูกตัดคนละบรรทัด — PR1950W วาง "Product" บรรทัดบน "Name | PR1950W" บรรทัดล่าง
// (ใบเดียวกันมี "Customer's" + "Name :" ด้วย ต่อแล้วถึงแยกออกว่าอันไหนของลูกค้า)
const STEM = /^(?:product|customer'?s?|trade|lot|batch)$/i;
function labelKeysAt(lines: string[][], li: number, ci: number): string[] {
  const key = labelKey(lines[li][ci]);
  if (ci !== 0 || li === 0) return [key];
  const prev = lines[li - 1];
  const prevKey = labelKey(prev[0] ?? "");
  // ต่อได้เฉพาะบรรทัดบนที่เป็นป้ายล้วน — บรรทัดที่มีค่าอยู่แล้ว (CUSTOMER|SUN MATERIALS) ไม่ใช่ป้ายค้าง
  const bare = prev.slice(1).every((c) => !cleanValue(c).value || LOOKS_LIKE_LABEL.test(norm(c)));
  return STEM.test(prevKey) && bare ? [key, `${prevKey} ${key}`] : [key];
}

export function recoverProductLot(text: string): ProductLot {
  const lines = text.split(/\r?\n/).map(cellsOf);
  const slot: Record<string, string | null> = {
    pTop: null, pStrong: null, pMedium: null, pWeak: null, lStrong: null, lWeak: null,
  };
  let productSaysNone = false; // ใบเขียน "Product: N/A" เอง = ห้ามไปเดาจากป้ายอ่อนกว่า

  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].length; ci++) {
      if (labelKey(lines[li][ci]).length > MAX_LABEL_LEN) continue;
      const keys = labelKeysAt(lines, li, ci);
      const isCustomer = keys.some((k) => CUSTOMER_LABEL.test(k));
      const lens = {
        pTop: isCustomer ? -1 : Math.max(...keys.map((k) => matchLen(k, PRODUCT_TOP))),
        pStrong: isCustomer ? -1 : Math.max(...keys.map((k) => matchLen(k, PRODUCT_STRONG))),
        pMedium: isCustomer ? -1 : Math.max(...keys.map((k) => matchLen(k, PRODUCT_MEDIUM))),
        pWeak: isCustomer ? -1 : Math.max(...keys.map((k) => matchLen(k, PRODUCT_WEAK))),
        lStrong: isCustomer ? -1 : Math.max(...keys.map((k) => matchLen(k, LOT_STRONG))),
        lWeak: isCustomer ? -1 : Math.max(...keys.map((k) => matchLen(k, LOT_WEAK))),
      };
      const pKind = (["pTop", "pStrong", "pMedium", "pWeak"] as const).find((k) => lens[k] >= 0);
      const lKind = (["lStrong", "lWeak"] as const).find((k) => lens[k] >= 0);
      if (!pKind && !lKind) continue;

      const eaten = Math.max(pKind ? lens[pKind] : 0, lKind ? lens[lKind] : 0);
      const nextLine = pKind === "pTop" || pKind === "pStrong" || lKind === "lStrong";
      for (const cand of valuesAfter(lines, li, ci, eaten, nextLine)) {
        const { value, explicitNone } = cleanValue(cand);
        if (explicitNone && pKind && pKind !== "pWeak") productSaysNone = true;
        if (!value) continue;
        if (pKind && validProduct(value)) {
          slot[pKind] ??= value;
          break;
        }
        if (lKind && validLot(value)) {
          slot[lKind] ??= value;
          break;
        }
      }
    }
  }

  const product =
    slot.pTop ?? slot.pStrong ?? slot.pMedium ?? (productSaysNone ? null : slot.pWeak);
  return { product: product ?? null, lotNo: slot.lStrong ?? slot.lWeak };
}
