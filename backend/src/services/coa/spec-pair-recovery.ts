// เกณฑ์ที่ใบเขียนเป็นสองช่อง ("34 | 42") แต่ OCR ทำขีดกลางหาย → LLM เก็บมาข้างเดียวเป็นเลขเปล่า
//   อ่าน header ของใบเองว่าช่องไหนคือค่าผล ช่องท้ายที่เหลือจึงเป็นเกณฑ์ — ไม่ผูกกับตำแหน่งคอลัมน์ใบใดใบหนึ่ง
import { RawCoaItem } from "./ollama-coa.service";
import { normalizeSpecFromCandidate } from "./spec-normalizer";
import { splitCells, singleNumberCell } from "./column-shift-recovery";

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
export function recoverSpecPairs(items: RawCoaItem[], ocrText: string): SpecPairResult {
  const paired: SpecPairResult["paired"] = [];
  if (!items?.length || !ocrText) return { paired };
  const lines = ocrText.split(/\r?\n/);
  const roles = findResultRoles(lines);
  if (!roles) return { paired };

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
    if (nums.length !== roles.length + 2) continue; // ต้องเหลือช่องเกณฑ์พอดี 2 ช่อง ไม่งั้นตัดสินไม่ได้
    if (!rolesConsistent(nums.slice(0, roles.length), roles)) continue;

    const lo = nums[nums.length - 2];
    const hi = nums[nums.length - 1];
    // ค่าที่ LLM เก็บมาต้องเป็นขอบใดขอบหนึ่งของคู่นี้ — ไม่งั้นแปลว่าคนละคอลัมน์
    if (Math.abs(spec.value - lo) > 1e-9 && Math.abs(spec.value - hi) > 1e-9) continue;

    const from = spec.raw;
    const to = `${Math.min(lo, hi)}~${Math.max(lo, hi)}`;
    it.specRaw = to;
    it.specMin = null;
    it.specMax = null;
    paired.push({ name: (it.name ?? "(unknown)").trim(), from, to });
  }
  return { paired };
}
