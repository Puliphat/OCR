// ใบที่มีเส้นตารางจริง → แถวข้อความ (เกณฑ์/ผลไม่ใช่ตัวเลข) เชื่อช่องของ grid ไม่เชื่อการจับคู่ของ LLM
//   text layer ใบญี่ปุ่นเรียงแบบคอลัมน์ (ชื่อทุกแถว → เกณฑ์ทุกแถว → ผลทุกแถว) LLM จึงจับเกณฑ์ข้ามแถวประจำ
import { CoaReport, EvaluatedItem, summarize } from "./coa-evaluator";

// แถวข้อความ = ไม่มีทั้งขอบเกณฑ์ที่เป็นเลขและค่าผลที่เป็นเลข (外観/結晶相/Foreign Particles)
function isTextRow(r: EvaluatedItem): boolean {
  return r.min == null && r.max == null && r.result == null;
}

export interface AdoptResult {
  adopted: string[];
  replaced: string[];
}

function rowKey(r: EvaluatedItem): string {
  return `${r.name}|${r.specRaw ?? ""}|${r.resultRaw ?? ""}`;
}

// แทนแถวข้อความของ flat ด้วยของ grid (mutate flat แล้วสรุปใหม่) — null = ไม่มีอะไรต้องเปลี่ยน
export function adoptGridTextRows(flat: CoaReport, grid: CoaReport): AdoptResult | null {
  const fromGrid = grid.rows.filter(isTextRow);
  if (fromGrid.length === 0) return null;

  const fromFlat = flat.rows.filter(isTextRow);
  const same =
    fromFlat.length === fromGrid.length &&
    fromFlat.every((r, i) => rowKey(r) === rowKey(fromGrid[i]));
  if (same) return null;

  // วางแถวข้อความไว้ตำแหน่งเดิมของ flat (ท้ายสุดถ้า flat ไม่มีแถวข้อความเลย)
  let insertAt = 0;
  while (insertAt < flat.rows.length && !isTextRow(flat.rows[insertAt])) insertAt++;

  const kept = flat.rows.filter((r) => !isTextRow(r));
  flat.rows = [
    ...kept.slice(0, insertAt),
    ...fromGrid.map((r) => ({ ...r })),
    ...kept.slice(insertAt),
  ];
  flat.summary = summarize(flat.rows);
  return { adopted: fromGrid.map((r) => r.name), replaced: fromFlat.map((r) => r.name) };
}
