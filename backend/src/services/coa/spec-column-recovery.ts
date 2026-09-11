// ★ Deterministic Specification-column recovery — DuPont "double Min/Max" layout ★
// Why: some COAs print both a "Batch" and "Specification" Min/Max group — qwen3:4b reads Batch as the spec, too narrow.
// ★ SAFETY ★ Mutates only spec fields, overrides on ≥2-block modal agreement, flags every affected row needsReview.
import { RawCoaItem } from "./ollama-coa.service";
import { EvaluatedItem, evaluateItem } from "./coa-evaluator";

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

// ★ Cross-page reconciliation — เอกสาร DuPont แบบ multi-batch (เคสจริง 1F1710) ★
// Why: pipeline อ่านทีละหน้า หน้าที่อ่านพลาด (เอา Batch มาเป็น Specification) ก็แคบกว่าจริงเงียบๆ เสี่ยง deceptive-FAIL
// โหวตด้วยจำนวนหน้าที่เห็นตรงกัน (≥2 หน้า ไม่เสมอ) มาแก้ — แตะเฉพาะแถว specDupont เท่านั้น ใบอื่นไม่กระทบ
export interface DupontReconcileResult {
  greened: number;
  corrected: { page: number; name: string; from: string; to: string; status: string }[];
}

export function reconcileDupontSpecs(
  pages: { page?: number; rows: EvaluatedItem[] }[]
): DupontReconcileResult {
  const out: DupontReconcileResult = { greened: 0, corrected: [] };
  if (!pages || pages.length < 2) return out; // ต้องมี ≥2 หน้าถึงจะมีอะไรมายัน

  // 1. จับกลุ่มแถว dupont ข้ามหน้าด้วยชื่อ (OCR เพี้ยนได้: Freeness/Freencss/Frceness → lev ≤ 3)
  type Entry = { row: EvaluatedItem; page: number };
  const groups: { key: string; entries: Entry[] }[] = [];
  for (const [i, pg] of pages.entries()) {
    const pageNo = pg.page ?? i + 1;
    for (const row of pg.rows ?? []) {
      if (!row.specDupont) continue;
      const k = nameKey(row.name);
      if (!k) continue;
      const g = groups.find((x) => x.key === k || lev(x.key, k) <= 3);
      if (g) g.entries.push({ row, page: pageNo });
      else groups.push({ key: k, entries: [{ row, page: pageNo }] });
    }
  }

  for (const g of groups) {
    // 2. โหวตระดับหน้า — 1 หน้าออกเสียงได้ band ละ 1 ครั้ง
    const pagesByBand = new Map<string, Set<number>>();
    for (const e of g.entries) {
      if (e.row.min == null || e.row.max == null) continue;
      const band = `${e.row.min}|${e.row.max}`;
      const s = pagesByBand.get(band) ?? new Set<number>();
      s.add(e.page);
      pagesByBand.set(band, s);
    }
    if (pagesByBand.size < 1) continue;
    const ranked = [...pagesByBand.entries()].sort((a, b) => b[1].size - a[1].size);
    const [winBand, winPages] = ranked[0];
    if (winPages.size < 2) continue;                                  // หลักฐานไม่พอ
    if (ranked[1] && ranked[1][1].size === winPages.size) continue;   // เสมอ → abstain

    const [wMin, wMax] = winBand.split("|").map(Number);
    // specRaw ของแถวที่อ่านถูก ใช้เป็นข้อความอ้างอิงตอนแก้แถวที่ผิด (รักษา format เดิมของใบ)
    const winRaw =
      g.entries.find((e) => e.row.min === wMin && e.row.max === wMax)?.row.specRaw ??
      `${wMin}~${wMax}`;

    for (const e of g.entries) {
      const onWin = e.row.min === wMin && e.row.max === wMax;
      if (onWin) {
        // หน้าอื่นยืนยันได้แค่ "ขอบเกณฑ์ถูก" — ตอบไม่ได้ว่าค่าผลที่ OCR 2 รอบเถียงกันเลขไหนคือเลขบนใบ
        if (e.row.needsReview && e.row.status === "PASS" && !e.row.valueDisputed) {
          e.row.needsReview = false;
          out.greened++;
        }
        continue;
      }
      if (e.row.min == null || e.row.max == null) continue; // ไม่มี band ให้เทียบ → ปล่อยตามเดิม
      const from = e.row.specRaw ?? `${e.row.min}~${e.row.max}`;
      const fixed = evaluateItem({
        name: e.row.name,
        unit: e.row.unit,
        method: e.row.method,
        specRaw: winRaw,
        specMin: null,
        specMax: null,
        result: e.row.resultRaw ?? e.row.result,
      });
      e.row.min = fixed.min;
      e.row.max = fixed.max;
      e.row.specRaw = fixed.specRaw;
      e.row.status = fixed.status;
      e.row.needsReview = true; // หน้านี้อ่าน spec พลาดมาแล้ว — ให้คนยืนยันแม้แก้ให้แล้ว
      e.row.reason = `spec ของหน้านี้ไม่ตรงกับหน้าอื่น (${from}) — ใช้ค่าที่ ${winPages.size} หน้าอ่านตรงกัน (${winRaw}) แทน เทียบกับใบจริง`;
      out.corrected.push({ page: e.page, name: e.row.name, from, to: winRaw, status: fixed.status });
    }
  }
  return out;
}
