// ★ Deterministic Specification-column recovery — DuPont "double Min/Max" layout ★
//
// Why: some vendor COAs (DuPont fiber/freeness sheets) print TWO Min/Max column groups per row —
//   a left "Batch" group (the lot's own measured min/max) and a right "Specification" group (the
//   acceptance limits). qwen3:4b reads the FIRST Min/Max it sees and reports the Batch range as the
//   spec — e.g. 1F1710 Fiber Length shows 0.990~1.180 (the batch spread) when the real spec is
//   0.920~1.420. The result value is correct; only the spec is mis-sourced. A wrong (often NARROWER)
//   spec is a latent deceptive-PASS risk, so it must be corrected from the document's own geometry.
//
// How (header-anchored, never positional-guess):
//   GATE  — abstain unless the grid carries BOTH a "Specification" header keyword AND at least one
//           column-header row with ≥2 "Min" and ≥2 "Max" cells (the double-group signature). No other
//           corpus layout has this, so the module is a strict no-op everywhere else.
//   BANDS — for each double-group column-header row, the Specification pair = the RIGHTMOST "Min" band
//           and RIGHTMOST "Max" band (Batch sits left, Spec sits right), requiring minCol < maxCol.
//   READ  — for each data row under that header, read those exact bands. A mangled cell (e.g. OCR
//           "S.000" for 5.000) → NaN → the row is REJECTED, never falling through to a neighbour
//           column (that is exactly how a fabricated spec would slip in).
//   AGREE — collect (min,max) candidates per item name across all blocks/pages of the grid; override
//           only when a modal pair has ≥2 agreeing reads AND a strict majority (ties → abstain).
//
// ★ SAFETY ★ Mutates only spec (specRaw/specMin/specMax), never result. Asserts a spec ONLY on
//   ≥2-block agreement; otherwise leaves the LLM value untouched. Every row of the detected layout is
//   returned in `dupontNames` so the caller flags it needsReview (spatial grid = inferred columns →
//   amber), keeping even a corrected spec out of silent clean-green.
import { RawCoaItem } from "./ollama-coa.service";

// "Specification" / "Specifications" / OCR "Spccification" — loose stem match
const SPEC_KW_RE = /sp\w*ificat/i;
const MIN_RE = /^min!?\.?$/i;
const MAX_RE = /^max\.?$/i;
const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
const LONE_NUM_RE = new RegExp(`^[<>≤≦≥≧]?\\s*${NUM}\\s*%?$`);
// header/section rows that are never measurement data
const SKIP_ROW_RE =
  /^(?:lot\b|production\b|prod\b|batch\b|page\b|customer\b|du\s*pont\b|bol\b|order\b|accept\b|by\b|property\b|proper|uom\b|spec)/i;

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

// a lone numeric cell (no embedded spaces/letters) — guards against "000 11" / "S.000" mangles
function isCleanNum(c: string): boolean {
  const s = nrm(c);
  return !!s && LONE_NUM_RE.test(s) && Number.isFinite(toNum(s));
}

function nameKey(s: string | null | undefined): string {
  return nrm(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Levenshtein — small fixed-name sets only (≤ a few dozen chars)
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// fuzzy name-key match — absorbs OCR garble in grid row names ("Canalian Stu Freencss" vs the LLM's
//   clean "Canadian Std Freeness"). Tight enough that the 3 distinct DuPont properties never cross-match
//   (their keys differ by far more than a third), so a wrong merge can't assert a spec.
function nameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const L = Math.max(a.length, b.length);
  const l = Math.min(a.length, b.length);
  if (L < 6) return false;
  if ((a.startsWith(b) || b.startsWith(a)) && l >= 5) return true;
  return lev(a, b) / L <= 0.34;
}

function splitGrid(gridText: string): string[][] {
  return (gridText ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("|").map((c) => nrm(c)))
    .filter((cells) => cells.some((c) => c !== ""));
}

const cellAt = (row: string[], i: number): string => (i >= 0 && i < row.length ? row[i] : "");

function idxsMatching(row: string[], re: RegExp): number[] {
  const out: number[] = [];
  for (let i = 0; i < row.length; i++) if (re.test(row[i])) out.push(i);
  return out;
}

// the Specification Min/Max bands of a double-group column header (rightmost Min/Max, Min left of Max)
function specBands(row: string[]): { minCol: number; maxCol: number } | null {
  const minIdxs = idxsMatching(row, MIN_RE);
  const maxIdxs = idxsMatching(row, MAX_RE);
  if (!minIdxs.length || !maxIdxs.length) return null;
  if (minIdxs.length < 2 && maxIdxs.length < 2) return null; // require the double-group signature
  const minCol = Math.max(...minIdxs);
  const maxCol = Math.max(...maxIdxs);
  if (minCol >= maxCol) return null; // spec Min must sit left of spec Max
  return { minCol, maxCol };
}

// parse the item's current spec to [min,max] for a differs-check (range / ± tolerance / min+max cols)
function currentRange(it: RawCoaItem): [number, number] | null {
  if (typeof it.specMin === "number" && typeof it.specMax === "number") return [it.specMin, it.specMax];
  const s = nrm(it.specRaw);
  if (!s) return null;
  let m = s.match(new RegExp(`^(${NUM})\\s*[~–—-]\\s*(${NUM})$`));
  if (m) return [toNum(m[1]), toNum(m[2])];
  m = s.match(new RegExp(`^(${NUM})\\s*(?:±|\\+/-|\\+-)\\s*(${NUM})$`));
  if (m) {
    const c = toNum(m[1]);
    const t = toNum(m[2]);
    return [c - t, c + t];
  }
  return null;
}

interface PairAgg {
  min: number;
  max: number;
  minRaw: string;
  maxRaw: string;
  n: number;
}

// choose the modal (min,max) pair for a name: ≥2 agreeing reads, strict majority (ties → abstain)
function chooseModal(pairs: Map<string, PairAgg>): PairAgg | null {
  const sorted = [...pairs.values()].sort((a, b) => b.n - a.n);
  if (!sorted.length) return null;
  const top = sorted[0];
  if (top.n < 2) return null;
  if (sorted[1] && sorted[1].n === top.n) return null;
  return top;
}

export interface SpecOverride {
  name: string;
  from: string;
  to: string;
}
export interface SpecRecoveryResult {
  overridden: SpecOverride[];
  dupontNames: string[]; // every item belonging to the detected layout (flag amber whether overridden or not)
}

// Recover the Specification Min/Max for DuPont double-min/max grids. Mutates items[].spec* in place.
// gridText MUST be the column-aware grid (rapidocr reconstructTextGrid / pdfplumber).
export function recoverSpecificationColumn(items: RawCoaItem[], gridText: string): SpecRecoveryResult {
  const empty: SpecRecoveryResult = { overridden: [], dupontNames: [] };
  if (!items?.length || !gridText?.trim()) return empty;

  const rows = splitGrid(gridText);
  if (rows.length < 3) return empty;

  // GATE — Specification keyword + a double-group header must both be present
  const hasSpecKw = rows.some((r) => r.some((c) => SPEC_KW_RE.test(c)));
  if (!hasSpecKw) return empty;
  const hasDoubleHeader = rows.some(
    (r) => idxsMatching(r, MIN_RE).length >= 2 && idxsMatching(r, MAX_RE).length >= 2
  );
  if (!hasDoubleHeader) return empty;

  // Walk rows: a double-group header sets the current Spec bands; data rows below it read those bands.
  const cands = new Map<string, Map<string, PairAgg>>(); // nameKey → pairKey → agg
  const dupontKeys = new Set<string>();
  let bands: { minCol: number; maxCol: number } | null = null;

  for (const r of rows) {
    const b = specBands(r);
    if (b) {
      bands = b; // this row IS a double-group column header
      continue;
    }
    if (!bands) continue; // orphan rows before the first header → cannot place columns
    const name0 = cellAt(r, 0);
    if (!name0 || SKIP_ROW_RE.test(name0)) continue;
    if (!r.some((c) => isCleanNum(c))) continue; // not a measurement row
    const nk = nameKey(name0);
    if (!nk) continue;
    dupontKeys.add(nk); // belongs to the layout (flag amber even if this read is mangled)

    const minRaw = cellAt(r, bands.minCol);
    const maxRaw = cellAt(r, bands.maxCol);
    if (!isCleanNum(minRaw) || !isCleanNum(maxRaw)) continue; // mangled cell → reject row (no fall-through)
    const mn = toNum(minRaw);
    const mx = toNum(maxRaw);
    if (!(mn < mx)) continue; // invalid pair → reject

    const pk = `${mn}|${mx}`;
    let byPair = cands.get(nk);
    if (!byPair) {
      byPair = new Map();
      cands.set(nk, byPair);
    }
    const agg = byPair.get(pk);
    if (agg) agg.n++;
    else byPair.set(pk, { min: mn, max: mx, minRaw: nrm(minRaw), maxRaw: nrm(maxRaw), n: 1 });
  }

  if (dupontKeys.size === 0) return empty;

  // Join to items: flag every matched name; override spec only on confident modal agreement.
  //   Fuzzy join — grid row names are OCR-garbled inconsistently across blocks, so pool every variant
  //   that matches this item before counting agreement (else each garble splits the vote and abstains).
  const overridden: SpecOverride[] = [];
  const dupontNames: string[] = [];
  for (const it of items) {
    const nk = nameKey(it.name);
    if (!nk) continue;
    const matchedKeys = [...dupontKeys].filter((gk) => nameMatches(gk, nk));
    if (!matchedKeys.length) continue;
    dupontNames.push(it.name ?? "");

    const merged = new Map<string, PairAgg>();
    for (const gk of matchedKeys) {
      const bp = cands.get(gk);
      if (!bp) continue;
      for (const [pk, agg] of bp) {
        const m = merged.get(pk);
        if (m) m.n += agg.n;
        else merged.set(pk, { ...agg });
      }
    }
    const chosen = chooseModal(merged);
    if (!chosen) continue; // not enough agreement → keep LLM spec (still flagged amber by caller)

    const cur = currentRange(it);
    if (cur && cur[0] === chosen.min && cur[1] === chosen.max) continue; // already correct → no-op

    const from =
      it.specRaw != null && nrm(it.specRaw)
        ? nrm(it.specRaw)
        : typeof it.specMin === "number" || typeof it.specMax === "number"
        ? `${it.specMin ?? ""}~${it.specMax ?? ""}`
        : "∅";
    // emit a verbatim range in specRaw (normalizeSpecFromCandidate checks specRaw first → between);
    //   clear specMin/specMax so no stale LLM bound lingers behind the range
    const to = `${chosen.minRaw}~${chosen.maxRaw}`;
    it.specRaw = to;
    it.specMin = null;
    it.specMax = null;
    overridden.push({ name: it.name ?? "", from, to });
  }

  return { overridden, dupontNames };
}
