// ★ Deterministic structural-grid parser — root fix for text-layer column-role mapping ★
//
// Why: even after pdfplumber recovers a clean 2D cell-grid, qwen3:4b cannot reliably map columns
//   to roles on idiosyncratic COA layouts (a merged "Specifications" header spanning several
//   columns, the result column headed by a lot number, ragged empty cells). On Suzorite it shifts
//   one column right — writing the spec range into the result field and dropping the real result
//   entirely (verified in coa-logs/_last-ollama.txt: result="Max 5"/"11.0〜16.0"). The grid is
//   geometrically clean but still STRUCTURALLY ambiguous: the result column sits at a VARIABLE
//   physical index per row, and a 4B model has no fixed anchor for that.
//
// Fix: classify each cell by CONTENT, not position. In a clean ruling-line grid every role has a
//   distinct textual signature — a spec is a range/bound, a result is a lone measured value, a mesh
//   designation (+100, -100/+200) is part of the item name. So role assignment is content-driven
//   and the variable-index problem dissolves. Emit RawCoaItem[] directly — NO LLM for structural
//   grids — and feed the SAME evaluator + guards. Deterministic, reproducible, zero new deps.
//
// ★ SAFETY ★ Runs only as the structural "grid challenger", gated by keep-best
//   (processPage/gridBeatsFlat): kept only when it strictly dominates the flat PASS set with 0 FAIL.
//   A misclassified grid can only fail-to-help, never regress. The parser ABSTAINS (null spec or
//   null result → honest SKIP) on any row it cannot confidently classify — it never guesses a role.
//
// ★ Output contract pinned to the normalizers (see spec-normalizer.ts / result-normalizer.ts) ★
//   - range / ± tolerance  → specRaw verbatim          (normalizeSpec → between)
//   - one-sided bound       → specMin / specMax NUMBER  (a bare number in min col → ge, max col → le)
//     ★ NEVER emit "Max 5" verbatim: normalizeSpec only reads number-first "5 Max", so word-first
//       "Max 5" → null → false SKIP. NEVER emit a direction-less bare number as a spec: op eq → the
//       evaluator's bare-eq guard auto-SKIPs it. Route every bound to specMin/specMax. ★
//   - result                → passed VERBATIM as a string (so "Traces" → normalizeResult null →
//     honest SKIP, and "<15" keeps its comparator for the bound-result path).
import { RawCoa, RawCoaItem } from "./ollama-coa.service";

export type GridOrient = "normal" | "transposed";

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
// range "1~8" / "92~100" / "11.0~16.0" / "275-425"; tolerance "26 ± 2"
const RANGE_RE = new RegExp(`^${NUM}\\s*[~–—-]\\s*${NUM}$`);
const TOL_RE = new RegExp(`^${NUM}\\s*(?:±|\\+/-|\\+-)\\s*${NUM}$`);
// a lone measured value (result) or single-sided numeric — optional comparator + optional %
const BARE_RE = new RegExp(`^[<>≤≦≥≧]?\\s*${NUM}\\s*%?$`);
// mesh designation: "+100", "-100/+200", "-325" — part of the item NAME, never a spec/result
const MESH_RE = /^[+\-]\s*\d+(?:\s*\/\s*[+\-]\s*\d+)?$/;
const METHOD_RE = /\b(?:ASTM|ISO|JIS|USP|AOAC|EN|DIN|GB|TIS)\b|method/i;

// normalize fullwidth / CJK glyphs to ASCII so the predicates and the downstream normalizers agree
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
  let c = s.trim();
  if (c.includes(",") && !c.includes(".")) c = c.replace(/,/g, ".");
  else c = c.replace(/,/g, "");
  return Number(c);
}

function isMesh(c: string): boolean {
  return MESH_RE.test(nrm(c));
}

// a lone measured value — excludes mesh designations ("-325" is a mesh fraction, not a result)
function isBare(c: string): boolean {
  const s = nrm(c);
  if (!s || isMesh(s)) return false;
  return BARE_RE.test(s);
}

function isMethod(c: string): boolean {
  return METHOD_RE.test(c);
}

function isUnitCell(c: string): boolean {
  const s = nrm(c);
  return /^[(（].*[)）]$/.test(s) && classifySpec(s) === null && !isBare(s);
}

function unitText(c: string): string | null {
  return nrm(c).replace(/^[(（]\s*/, "").replace(/\s*[)）]$/, "").trim() || null;
}

interface SpecCells {
  specRaw?: string;
  specMin?: number;
  specMax?: number;
}

// classify ONE cell as a spec, or null. range/tolerance → verbatim specRaw; bound → numeric min/max.
function classifySpec(c: string): SpecCells | null {
  const s = nrm(c);
  if (!s) return null;
  if (RANGE_RE.test(s) || TOL_RE.test(s)) return { specRaw: s };
  // word-first "Max 5" / "Min 1"
  let m = s.match(new RegExp(`^(max|min)\\.?\\s*(${NUM})$`, "i"));
  if (m) return m[1].toLowerCase() === "max" ? { specMax: toNum(m[2]) } : { specMin: toNum(m[2]) };
  // number-first "5 Max" / "99 Min"
  m = s.match(new RegExp(`^(${NUM})\\s*(max|min)\\.?$`, "i"));
  if (m) return m[2].toLowerCase() === "max" ? { specMax: toNum(m[1]) } : { specMin: toNum(m[1]) };
  // symbol bounds: ≤ ≦ <= < (upper) · ≥ ≧ >= > (lower)
  m = s.match(new RegExp(`^(?:≤|≦|<=|<)\\s*(${NUM})$`));
  if (m) return { specMax: toNum(m[1]) };
  m = s.match(new RegExp(`^(?:≥|≧|>=|>)\\s*(${NUM})$`));
  if (m) return { specMin: toNum(m[1]) };
  return null;
}

function splitGrid(gridText: string): string[][] {
  const rows = (gridText ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("|").map((c) => nrm(c)))
    .filter((cells) => cells.some((c) => c !== ""));
  if (rows.length === 0) return rows;
  const ncol = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => (r.length < ncol ? [...r, ...Array(ncol - r.length).fill("")] : r));
}

// a row is a HEADER when it carries no spec cell, no data number, and at least one header keyword.
function isHeaderRow(r: string[]): boolean {
  if (r.some((c) => classifySpec(c)) || r.some((c) => isBare(c))) return false;
  return r.some((c) => /^(item|method|spec|lot|parameter|test|result|unit|standard|grade|no\.?)\b/i.test(c));
}

// Result column lives at a fixed (but unknown) index — find it once globally so per-row spec search
// can exclude it. Score each column by how many rows hold a lone number THERE while also having a
// spec cell elsewhere (a result co-occurs with a spec on its row). argmax, ties → rightmost.
function resolveResultCol(dataRows: string[][], ncol: number): number {
  const score = new Array(ncol).fill(0);
  for (const row of dataRows) {
    const hasSpec = row.some((c) => classifySpec(c));
    if (!hasSpec) continue;
    for (let j = 0; j < row.length; j++) if (isBare(row[j])) score[j]++;
  }
  let best = -1;
  let bestScore = 1; // require ≥2 rows of evidence to lock a column
  for (let j = ncol - 1; j >= 0; j--) {
    if (score[j] > bestScore) {
      bestScore = score[j];
      best = j;
    }
  }
  if (best >= 0) return best;
  // fallback (small / unscored grids): rightmost column with any bare number
  for (let j = ncol - 1; j >= 0; j--) {
    if (dataRows.some((row) => isBare(row[j]))) return j;
  }
  return ncol - 1;
}

// Parse a pdfplumber structural grid into RawCoa with NO LLM. orient is informational: pdf_table.py
// has already transposed transposed COAs, so the grid is always items-as-rows by the time we see it.
export function parseStructuralGrid(gridText: string, _orient: GridOrient): RawCoa {
  const rows = splitGrid(gridText);
  if (rows.length === 0) return { product: null, lotNo: null, items: [] };
  const ncol = rows[0].length;

  let lotNo: string | null = null;
  let dataRows = rows;
  if (rows.length > 1 && isHeaderRow(rows[0])) {
    for (const c of rows[0]) {
      const m = c.match(/lot\s*no\.?\s*([A-Za-z0-9\-]+)/i);
      if (m) {
        lotNo = m[1];
        break;
      }
    }
    dataRows = rows.slice(1);
  }

  const resultCol = resolveResultCol(dataRows, ncol);

  const items: RawCoaItem[] = [];
  let section = "";
  for (const row of dataRows) {
    const col0 = row[0] ?? "";
    if (col0 && !isMesh(col0)) section = col0;

    // locate per-row special cells (content-driven, excluding the locked result column)
    let meshIdx = -1;
    let methodIdx = -1;
    let unitIdx = -1;
    for (let j = 0; j < row.length; j++) {
      if (j === resultCol) continue;
      const c = row[j];
      if (!c) continue;
      if (meshIdx < 0 && isMesh(c)) meshIdx = j;
      else if (methodIdx < 0 && isMethod(c)) methodIdx = j;
      else if (unitIdx < 0 && isUnitCell(c)) unitIdx = j;
    }

    const base = col0 && !isMesh(col0) ? col0 : section;
    const mesh = meshIdx >= 0 ? row[meshIdx] : "";
    const name = mesh ? `${base} ${mesh}`.trim() : base;
    const method = methodIdx >= 0 ? row[methodIdx] : null;
    const unit = unitIdx >= 0 ? unitText(row[unitIdx]) : null;
    const resultRaw = resultCol >= 0 ? row[resultCol] ?? "" : "";

    // spec = first spec-pattern cell, excluding name(0)/mesh/method/unit/result columns
    let spec: SpecCells | null = null;
    for (let j = 0; j < row.length; j++) {
      if (j === 0 || j === resultCol || j === meshIdx || j === methodIdx || j === unitIdx) continue;
      const got = classifySpec(row[j]);
      if (got) {
        spec = got;
        break;
      }
    }

    // ABSTAIN: a spacer row (no spec, no result) is dropped; a row with no identifiable name is not
    //   emitted (phantom). A row with only one of spec/result still emits → evaluator honest-SKIPs.
    if (!spec && !resultRaw) continue;
    if (!base && !mesh) continue;

    items.push({
      name,
      unit,
      method,
      specRaw: spec?.specRaw ?? null,
      specMin: spec?.specMin ?? null,
      specMax: spec?.specMax ?? null,
      result: resultRaw || null,
    });
  }

  return { product: null, lotNo, items };
}
