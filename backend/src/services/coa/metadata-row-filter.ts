// กรอง "junk metadata rows" ที่ LLM ดึงมาเป็น item ทั้งที่ไม่ใช่รายการทดสอบ
// เช่น "Lot number 1", "Production Date", "ACCEPT", "Item" (header ของตาราง)
import { CoaItemInput } from "./coa-evaluator";
import { normalizeSpecFromCandidate } from "./spec-normalizer";

// ชื่อ row ที่เป็น metadata (ไม่ใช่ test item): pattern เหล่านี้ต้องสอดคล้องกับ garble จริงจาก OCR
// เรียงจาก specific → generic (ลำดับไม่มีผล เพราะใช้ Array.some)
const METADATA_PATTERNS: RegExp[] = [
  // "Lot number", "Lot mumber", "Lotmumber", "Lot number 1", "Lot number I" — OCR garble m/n/space
  /^lot\s*[mn]umber/i,
  // "Production Date", "Praduction Date" — OCR garble vowel
  /^pr[ao]duction\s*date/i,
  // "ACCEPT" เฉยๆ (exact)
  /^accept$/i,
  // "Item" เฉยๆ — header ของตาราง (ต้อง exact: ห้าม match "Items tested" / "Item No.")
  /^item$/i,
];

export interface FilterResult {
  kept: CoaItemInput[];
  dropped: CoaItemInput[];
}

// ตรวจว่า item มี spec ที่ใช้ได้จริง (ไม่ใช่ null/undefined ทั้งคู่ และ parse เป็นตัวเลขได้)
// ถ้ามี spec → ห้าม drop เด็ดขาด แม้ชื่อจะ match pattern
function hasUsableSpec(item: CoaItemInput): boolean {
  const spec = normalizeSpecFromCandidate({
    specRaw: item.specRaw,
    min: item.specMin,
    max: item.specMax,
  });
  return spec !== null;
}

// กรอง metadata rows ออกจาก items — conservative: drop เฉพาะที่ (a) ชื่อ match pattern AND (b) ไม่มี spec
export function filterMetadataRows(items: CoaItemInput[]): FilterResult {
  const kept: CoaItemInput[] = [];
  const dropped: CoaItemInput[] = [];

  for (const item of items) {
    const name = (item.name ?? "").trim();
    const nameLower = name.toLowerCase();

    // เช็ค (a): ชื่อ match pattern metadata
    const matchesMeta = METADATA_PATTERNS.some((re) => re.test(nameLower));
    if (!matchesMeta) {
      kept.push(item);
      continue;
    }

    // เช็ค (b): มี spec จริง → ห้าม drop
    if (hasUsableSpec(item)) {
      kept.push(item);
      continue;
    }

    // ทั้งสองเงื่อนไขครบ → drop
    dropped.push(item);
  }

  return { kept, dropped };
}
