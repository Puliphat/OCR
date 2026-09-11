// เกณฑ์ที่ใบเขียนเป็นสองช่อง ("34 | 42") แต่ OCR ทำขีดกลางหาย → LLM เก็บมาข้างเดียวเป็นเลขเปล่า
//   อ่าน header ของใบเองว่าช่องไหนคือค่าผล ช่องท้ายที่เหลือจึงเป็นเกณฑ์ — ไม่ผูกกับตำแหน่งคอลัมน์ใบใดใบหนึ่ง
import { RawCoaItem } from "./ollama-coa.service";
import { normalizeSpecFromCandidate } from "./spec-normalizer";
import { splitCells, singleNumberCell } from "./column-shift-recovery";
import { OcrToken } from "./rapidocr.service";
import { cx, clusterRows, rowNameKey } from "./ocr-grid";

export interface SpecPairResult {
  paired: { name: string; from: string; to: string }[];
}

const SPEC_HEAD = /^(spec(ification)?s?\.?|規格値?|規格)$/i;
const RESULT_HEAD = /^(avg|average|mean|max|min|result|results|actual)\.?$/i;

// role ของช่องผล เรียงตาม header (ใช้ตรวจว่าค่าสอดคล้องกันจริงก่อนเชื่อการแบ่งช่อง)
type Role = "avg" | "max" | "min" | "other";
function roleOf(cell: string): Role {
  const c = cell.trim().toLowerCase().replace(/\.$/, "");
  if (c === "max") return "max";
  if (c === "min") return "min";
  if (c === "avg" || c === "average" || c === "mean") return "avg";
  return "other";
}

// header ที่จบด้วยช่องเกณฑ์ และมีช่องผลอยู่ก่อนหน้า — คืน role ของช่องผลเรียงซ้าย→ขวา
function findResultRoles(lines: string[]): Role[] | null {
  for (const line of lines) {
    const cells = splitCells(line);
    if (cells.length < 3) continue;
    if (!SPEC_HEAD.test(cells[cells.length - 1].trim())) continue;
    const roles: Role[] = [];
    for (let i = cells.length - 2; i >= 0; i--) {
      if (!RESULT_HEAD.test(cells[i].trim())) break;
      roles.unshift(roleOf(cells[i]));
    }
    if (roles.length >= 1) return roles;
  }
  return null;
}

// ค่าผลต้องสอดคล้องกับ role ที่ header บอก (max ≥ avg ≥ min) — ไม่สอดคล้อง = แบ่งช่องผิด
function rolesConsistent(values: number[], roles: Role[]): boolean {
  const pick = (r: Role) => {
    const i = roles.indexOf(r);
    return i >= 0 ? values[i] : null;
  };
  const mx = pick("max");
  const mn = pick("min");
  const av = pick("avg");
  if (mx != null && mn != null && mx < mn) return false;
  if (mx != null && av != null && mx < av) return false;
  if (mn != null && av != null && av < mn) return false;
  return true;
}

// ใบสแกนที่เกณฑ์เป็น 2 ช่อง (ต่ำ|สูง) แต่บางแถวพิมพ์ช่องเดียว (CIIR1066 ANTIOXIDANT "0.02")
//   ช่องว่างไม่เหลือร่องรอยใน flat text จึงแยกไม่ออกว่าช่องไหนหาย → ทิศต้องมาจากพิกัด x ของ token

interface NumCell {
  value: number;
  cx: number;
}

interface SpecCols {
  loCx: number;
  hiCx: number;
  gap: number;
}

const cellNum = (t: OcrToken): number | null => singleNumberCell(t.text.replace(/%\s*$/, ""));

// เลขทุกตัวในแถว เรียงซ้าย→ขวา พร้อมพิกัดกลางช่อง
function numericCells(row: OcrToken[]): NumCell[] {
  const out: NumCell[] = [];
  for (const t of [...row].sort((a, b) => cx(a) - cx(b))) {
    const v = cellNum(t);
    if (v != null) out.push({ value: v, cx: cx(t) });
  }
  return out;
}

// ชื่อแถว = token ก่อนถึงเลขตัวแรก (ช่องหน่วยที่เป็นตัวอักษรติดมาด้วยได้ rowNameKey ตัดทิ้งอยู่แล้ว)
function rowLabel(row: OcrToken[]): string {
  const sorted = [...row].sort((a, b) => cx(a) - cx(b));
  const firstNum = sorted.findIndex((t) => cellNum(t) != null);
  return (firstNum < 0 ? sorted : sorted.slice(0, firstNum)).map((t) => t.text).join(" ");
}

// หาว่าคอลัมน์เกณฑ์ 2 ช่องอยู่ตรงไหน — ดูจากแถวที่พิมพ์ครบทั้งคู่บนใบเดียวกัน ไม่ใช่จากหัวตาราง
//   แถวไหนเลขไม่ตกคอลัมน์เดียวกับเพื่อน = อ่านพิกัดไม่ตรง ถอยทั้งใบ (ดีกว่าเดาทิศผิด)
function findSpecColumns(rows: OcrToken[][], rolesLen: number, medianH: number): SpecCols | null {
  const los: number[] = [];
  const his: number[] = [];
  for (const r of rows) {
    const nums = numericCells(r);
    if (nums.length !== rolesLen + 2) continue;
    const lo = nums[nums.length - 2];
    const hi = nums[nums.length - 1];
    if (lo.value > hi.value) return null; // ช่องซ้ายต้องเป็นขอบล่างเสมอ ไม่งั้นอ่านผิดตาราง
    los.push(lo.cx);
    his.push(hi.cx);
  }
  if (los.length < 2) return null;

  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const loCx = med(los);
  const hiCx = med(his);
  const gap = hiCx - loCx;
  if (gap < 2 * medianH) return null; // สองช่องชิดกันเกินกว่าจะแยกได้

  const offColumn = (v: number, center: number) => Math.abs(v - center) > gap * 0.25;
  if (los.some((v) => offColumn(v, loCx)) || his.some((v) => offColumn(v, hiCx))) return null;
  return { loCx, hiCx, gap };
}

// เลขเกณฑ์ตัวเดียวของแถวนี้นั่งช่องต่ำหรือช่องสูง — ต้องชิดช่องใดช่องหนึ่งชัด ไม่งั้นไม่ตัดสิน
function sideOfSingleBound(
  rows: OcrToken[][],
  cols: SpecCols,
  rolesLen: number,
  itemName: string,
  value: number
): "min" | "max" | null {
  const key = rowNameKey(itemName);
  if (key.length < 2) return null;

  const hits = rows.filter((r) => rowNameKey(rowLabel(r)) === key);
  if (hits.length !== 1) return null;

  const nums = numericCells(hits[0]);
  if (nums.length !== rolesLen + 1) return null;
  const b = nums[nums.length - 1];
  if (Math.abs(b.value - value) > 1e-9) return null;

  const dLo = Math.abs(b.cx - cols.loCx);
  const dHi = Math.abs(b.cx - cols.hiCx);
  if (Math.min(dLo, dHi) > cols.gap * 0.25) return null; // ไม่ตกช่องไหนเลย
  if (Math.abs(dLo - dHi) < cols.gap * 0.3) return null; // อยู่กลางระหว่างสองช่อง = กำกวม
  return dLo < dHi ? "min" : "max";
}

function nameSig(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /\d/.test(t));
}

function anchorCells(name: string, lines: string[]): string[] | null {
  const sig = nameSig(name);
  if (!sig.length) return null;
  const need = Math.max(1, Math.ceil(sig.length * 0.6));
  const hits = lines.filter((l) => {
    const ls = nameSig(l);
    return sig.filter((t) => ls.includes(t)).length >= need;
  });
  return hits.length === 1 ? splitCells(hits[0]) : null;
}

// mutate items in place — เติมขอบที่ขาดให้แถวที่เกณฑ์เหลือเลขเปล่า คืนรายการที่แก้
//   tokens = พิกัด OCR ของหน้าสแกน (ไม่มี = หน้า text-layer) ใช้เฉพาะแถวที่ใบพิมพ์ขอบเดียว
export function recoverSpecPairs(
  items: RawCoaItem[],
  ocrText: string,
  tokens?: OcrToken[]
): SpecPairResult {
  const paired: SpecPairResult["paired"] = [];
  if (!items?.length || !ocrText) return { paired };
  const lines = ocrText.split(/\r?\n/);
  const roles = findResultRoles(lines);
  if (!roles) return { paired };

  let tokenRows: OcrToken[][] | null = null;
  let specCols: SpecCols | null = null;
  if (tokens?.length) {
    const clustered = clusterRows(tokens);
    tokenRows = clustered.rows;
    specCols = findSpecColumns(clustered.rows, roles.length, clustered.medianH);
  }

  for (const it of items) {
    const spec = normalizeSpecFromCandidate({
      specRaw: it.specRaw,
      min: it.specMin,
      max: it.specMax,
    });
    if (!spec || spec.op !== "eq" || spec.value == null) continue; // เลขเปล่าเท่านั้น (ทิศหาย)

    const cells = anchorCells(it.name ?? "", lines);
    if (!cells) continue;
    const nums = cells
      .map((c) => singleNumberCell(c.replace(/%$/, "")))
      .filter((v): v is number => v != null);
    if (nums.length !== roles.length + 2 && nums.length !== roles.length + 1) continue;
    if (!rolesConsistent(nums.slice(0, roles.length), roles)) continue;

    const from = spec.raw;
    const name = (it.name ?? "(unknown)").trim();

    // ใบพิมพ์ขอบเดียว — ทิศมาจากช่องที่เลขนั้นนั่งอยู่ เทียบกับแถวอื่นบนใบที่พิมพ์ครบทั้งคู่
    if (nums.length === roles.length + 1) {
      if (!tokenRows || !specCols) continue;
      const only = nums[nums.length - 1];
      if (Math.abs(spec.value - only) > 1e-9) continue;
      const side = sideOfSingleBound(tokenRows, specCols, roles.length, it.name ?? "", only);
      if (!side) continue;

      it.specRaw = null; // ให้ทิศมาจากคอลัมน์ (ดู normalizeSpecFromCandidate) ไม่ใช่ข้อความที่ LLM เดา
      it.specMin = side === "min" ? only : null;
      it.specMax = side === "max" ? only : null;
      it.specFromCell = true;
      paired.push({ name, from, to: side === "min" ? `≥${only}` : `≤${only}` });
      continue;
    }

    const lo = nums[nums.length - 2];
    const hi = nums[nums.length - 1];
    // ค่าที่ LLM เก็บมาต้องเป็นขอบใดขอบหนึ่งของคู่นี้ — ไม่งั้นแปลว่าคนละคอลัมน์
    if (Math.abs(spec.value - lo) > 1e-9 && Math.abs(spec.value - hi) > 1e-9) continue;

    const to = `${Math.min(lo, hi)}~${Math.max(lo, hi)}`;
    it.specRaw = to;
    it.specMin = null;
    it.specMax = null;
    paired.push({ name, from, to });
  }
  return { paired };
}
