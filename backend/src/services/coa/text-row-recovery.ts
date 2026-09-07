// แถวข้อความที่ใบเขียนสองภาษา/สองบรรทัด (色相: 淡黄色 + Light Yellow Color) — OCR ตัดคนละท่อน
//   ให้เกณฑ์กับผล ทำให้เทียบไม่ตรงทั้งที่ใบเขียนเหมือนกัน. ท่อนที่โผล่ทั้งสองคอลัมน์ = ตรงกันจริง
import { EvaluatedItem, textKey } from "./coa-evaluator";

export interface TextRowResult {
  recovered: { name: string; spec: string; result: string }[];
}

const BLOCK_LINES = 4; // cell ข้อความยาวถูกตัดได้ไม่กี่บรรทัด — กว้างกว่านี้เริ่มกินแถวถัดไป

function occurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

// mutate rows in place — คืนแถวที่เปลี่ยนเป็น PASS
export function recoverSplitTextRows(rows: EvaluatedItem[], ocrText: string): TextRowResult {
  const recovered: TextRowResult["recovered"] = [];
  if (!rows?.length || !ocrText) return { recovered };
  const lines = ocrText.split(/\r?\n/);
  const keys = lines.map((l) => textKey(l));

  for (const r of rows) {
    if (r.status !== "SKIP" || r.result != null) continue;
    const specKey = textKey(r.specRaw);
    const resultKey = textKey(r.resultRaw);
    if (!specKey || !resultKey || specKey === resultKey) continue;

    const nameKey = textKey(r.name);
    if (!nameKey) continue;
    const idxs = keys
      .map((k, i) => (k.includes(nameKey) ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length !== 1) continue; // ชื่อโผล่หลายที่ = ไม่รู้ว่าบล็อกไหนของแถวนี้

    const block = keys.slice(idxs[0], idxs[0] + 1 + BLOCK_LINES).join("");
    // ★ ท่อนละ 2 ครั้ง = ท่อนนั้นอยู่ทั้งช่องเกณฑ์และช่องผล ★ — โผล่ครั้งเดียวแปลว่าอยู่ข้างเดียวจริง
    if (occurrences(block, specKey) < 2 || occurrences(block, resultKey) < 2) continue;

    r.status = "PASS";
    r.reason = `ข้อความตรงกับเกณฑ์บนใบ (ใบเขียนไว้ทั้งสองช่อง: ${r.specRaw} / ${r.resultRaw})`;
    recovered.push({
      name: r.name,
      spec: r.specRaw ?? "",
      result: r.resultRaw ?? "",
    });
  }
  return { recovered };
}
