// ★ Deterministic Average/Mean-column recovery ★
//
// Why: some COA tables list several per-sample measurements followed by an Average/Mean column, and
//   the AVERAGE is the authoritative result the spec compares against (not any single measurement).
//   A small LLM (qwen3:4b) reads this inconsistently — verified on Lot240521 "Sieve Residue on 150μ"
//   (measurements 54/56/58, Average 56.0): the model picked the last measurement 58 instead of 56.0.
//   The fix is NOT a smarter prompt — it's to read the result deterministically from the column-aware
//   OCR grid, where every cell sits at a fixed global column band.
//
// How: locate a header cell that LITERALLY reads "Average"/"Mean"/"Avg" → that band is the result
//   column. Read each data row's cell at that band; if it is a lone measured number, it is the true
//   result. Join grid rows to the LLM items by the spec text (the cell immediately right of the avg
//   column — distinctive and copied verbatim by the LLM), with a normalized-name fallback. Override
//   only when the recovered average is numeric and differs from the LLM result.
//
// ★ SAFETY ★ ABSTAINS unless an avg-header column is confidently identified (header keyword + ≥2 data
//   rows with a lone numeric avg cell). Never guesses a column. Override = correcting to the document's
//   own authoritative figure, not inventing data. The caller flags needsReview on changed PASS rows
//   (spatial grids = inferred columns → amber), keeping a corrected value out of silent clean-green.
import { RawCoaItem } from "./ollama-coa.service";

const AVG_HEADER_RE = /^(?:average|mean|avg\.?)$/i;
const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
// a lone measured value (optional comparator + optional %) — the shape of a result/average cell
const LONE_NUM_RE = new RegExp(`^[<>≤≦≥≧]?\\s*${NUM}\\s*%?$`);

// normalize fullwidth / CJK glyphs to ASCII + collapse whitespace (sync with the grid parser/normalizers)
function nrm(c: string | undefined): string {
  return (c ?? "")
    .replace(/＋/g, "+")
    .replace(/[～〜∼]/g, "~")
    .replace(/％/g, "%")
    .replace(/＜/g, "<")
    .replace(/＞/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// EU decimal (0,28 → 0.28) vs US thousands (1,000 → 1000) — sync with spec/result normalizers
function toNum(s: string): number {
  let c = nrm(s).replace(/^[<>≤≦≥≧]\s*/, "").replace(/\s*%$/, "");
  if (c.includes(",") && !c.includes(".")) c = c.replace(/,/g, ".");
  else c = c.replace(/,/g, "");
  return Number(c);
}

function isLoneNumber(c: string): boolean {
  const s = nrm(c);
  return !!s && LONE_NUM_RE.test(s) && Number.isFinite(toNum(s));
}

// join key for the spec cell — lowercased, glyph-normalized (LLM copies specRaw verbatim from the grid)
function specKey(s: string | null | undefined): string {
  return nrm(s ?? "").toLowerCase();
}

// alnum-only name key (LLM reformats the name slightly; this absorbs spacing/case noise)
function nameKey(s: string | null | undefined): string {
  return nrm(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// split a "|"-separated column-aware grid into rows of trimmed cells. Trailing empties are dropped by
// the grid builder, so cell access is bounds-checked (a row may be shorter than the header).
function splitGrid(gridText: string): string[][] {
  return (gridText ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("|").map((c) => nrm(c)))
    .filter((cells) => cells.some((c) => c !== ""));
}

const cellAt = (row: string[], i: number): string => (i >= 0 && i < row.length ? row[i] : "");

export interface AvgOverride {
  name: string;
  from: string | null;
  to: string;
}
export interface AvgRecoveryResult {
  overridden: AvgOverride[];
}

// Recover the Average/Mean column as the result. Mutates items[].result in place; returns the overrides.
// gridText MUST be the column-aware grid (rapidocr reconstructTextGrid or pdfplumber) — a flat text
// block has no stable columns and is rejected (no avg header → no-op).
export function recoverAverageColumn(
  items: RawCoaItem[],
  gridText: string
): AvgRecoveryResult {
  const empty: AvgRecoveryResult = { overridden: [] };
  if (!items?.length || !gridText?.trim()) return empty;

  const rows = splitGrid(gridText);
  if (rows.length < 2) return empty;

  // 1) locate the avg-header column (first cell literally "Average"/"Mean"/"Avg") + the spec column
  //    immediately to its right (first non-empty header cell after avgCol).
  let headerRowIdx = -1;
  let avgCol = -1;
  let specCol = -1;
  for (let ri = 0; ri < rows.length && avgCol < 0; ri++) {
    const r = rows[ri];
    for (let ci = 0; ci < r.length; ci++) {
      if (AVG_HEADER_RE.test(r[ci])) {
        headerRowIdx = ri;
        avgCol = ci;
        for (let cj = ci + 1; cj < r.length; cj++) {
          if (r[cj] !== "") {
            specCol = cj;
            break;
          }
        }
        break;
      }
    }
  }
  if (avgCol < 0) return empty;

  // 2) collect data rows below the header where the avg-column cell is a lone number. Build join maps
  //    spec→avg and name→avg; drop any key whose rows disagree (ambiguous → abstain on that key).
  const specMap = new Map<string, string | null>(); // null = collision sentinel
  const nameMap = new Map<string, string | null>();
  let numericRows = 0;
  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const avgCell = cellAt(r, avgCol);
    if (!isLoneNumber(avgCell)) continue;
    numericRows++;
    const sk = specCol >= 0 ? specKey(cellAt(r, specCol)) : "";
    const nk = nameKey(cellAt(r, 0));
    if (sk) {
      if (!specMap.has(sk)) specMap.set(sk, avgCell);
      else if (toNum(specMap.get(sk) ?? "") !== toNum(avgCell)) specMap.set(sk, null);
    }
    if (nk) {
      if (!nameMap.has(nk)) nameMap.set(nk, avgCell);
      else if (toNum(nameMap.get(nk) ?? "") !== toNum(avgCell)) nameMap.set(nk, null);
    }
  }
  // need ≥2 numeric avg rows as evidence the column is real (a single hit could be a coincidence)
  if (numericRows < 2) return empty;

  // 3) override each item's result with the recovered average (spec-key first, name-key fallback)
  const overridden: AvgOverride[] = [];
  for (const it of items) {
    let avgCell: string | null | undefined;
    const sk = specKey(it.specRaw);
    if (sk && specMap.has(sk)) avgCell = specMap.get(sk);
    if (avgCell == null) {
      const nk = nameKey(it.name);
      if (nk && nameMap.has(nk)) avgCell = nameMap.get(nk);
    }
    if (avgCell == null) continue; // no confident match (or ambiguous collision) → keep LLM value

    const avgNum = toNum(avgCell);
    if (!Number.isFinite(avgNum)) continue;

    // only override when it actually changes the value (numeric compare absorbs "329" vs "329.0")
    const curNum =
      typeof it.result === "number"
        ? it.result
        : typeof it.result === "string"
        ? toNum(it.result)
        : NaN;
    if (Number.isFinite(curNum) && curNum === avgNum) continue;

    const from =
      it.result == null
        ? null
        : typeof it.result === "string"
        ? it.result
        : typeof it.result === "number"
        ? String(it.result)
        : JSON.stringify(it.result);
    it.result = avgCell;
    overridden.push({ name: it.name ?? "", from, to: avgCell });
  }

  return { overridden };
}
