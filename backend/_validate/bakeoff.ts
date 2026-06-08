// Bake-off: which model reads Lot240521 correctly? (the known-wrong file)
// text path: qwen2.5:3b vs 7b (same OCR text) · vision path: qwen2.5vl:3b (image direct)
// score each extracted row vs ground truth; N runs each → accuracy + stability (qwen non-deterministic)
// run from backend/: npx ts-node _validate/bakeoff.ts [N]
import axios from "axios";
import * as path from "path";
import { extractText } from "../src/services/coa/coa-pipeline";
import { OllamaCoaService, RawCoa } from "../src/services/coa/ollama-coa.service";
import { recoverSpecsFromOcr, correctSpecDirectionFromOcr } from "../src/services/coa/spec-recovery";
import { dropUngroundedItems } from "../src/services/coa/coa-grounding";
import { evaluateCoa } from "../src/services/coa/coa-evaluator";
import { ImageProcessingService } from "../src/services/image-processing.service";

const FILE = "uploads/20260203_Lot240521.png";
const N = Number(process.argv[2] ?? 4);

// ground truth (จาก OCR ที่อ่านถูก + ผู้ใช้ยืนยัน)
const GT = [
  { key: "500", label: "Sieve 500u", result: 0.3, min: null as number | null, max: 3 },
  { key: "350", label: "Sieve 350u", result: 42.3, min: 15, max: 45 },
  { key: "150on", label: "Sieve 150u", result: 56, min: 45, max: 75 },
  { key: "under", label: "Sieve under150", result: 1.3, min: null as number | null, max: 20 },
  { key: "bulk", label: "Bulk Density", result: 329, min: 270, max: 350 },
];

function matchKey(name: string): string | null {
  const n = (name || "").toLowerCase();
  if (/bulk|densit/.test(n)) return "bulk";
  if (/under/.test(n)) return "under";
  if (/500/.test(n)) return "500";
  if (/350/.test(n)) return "350";
  if (/150/.test(n)) return "150on";
  return null;
}
function eq(a: any, b: number | null): boolean {
  if (b == null) return a == null;
  if (a == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.06;
}

interface Row { name: string; result: any; min: any; max: any }
// score one extraction (array of {name,result,min,max}) vs GT
function score(rows: Row[]) {
  let resultOk = 0, specOk = 0, fullOk = 0;
  const detail: string[] = [];
  for (const g of GT) {
    const r = rows.find((x) => matchKey(x.name) === g.key);
    const rOk = r ? eq(r.result, g.result) : false;
    const sOk = r ? eq(r.min, g.min) && eq(r.max, g.max) : false;
    if (rOk) resultOk++;
    if (sOk) specOk++;
    if (rOk && sOk) fullOk++;
    const got = r ? `res=${r.result} min=${r.min} max=${r.max}` : "MISSING";
    detail.push(`    ${g.label.padEnd(15)} want res=${g.result} min=${g.min} max=${g.max} | got ${got} ${rOk && sOk ? "OK" : rOk ? "spec✗" : "✗"}`);
  }
  return { resultOk, specOk, fullOk, detail };
}

// text path: prod chain (parse → drop → recover → direction → evaluate), guards ไม่แตะค่า เลยข้าม
function rowsFromText(raw: RawCoa, text: string): Row[] {
  const g = dropUngroundedItems(raw.items ?? [], text);
  const items = g.kept;
  recoverSpecsFromOcr(items, text);
  correctSpecDirectionFromOcr(items, text);
  const ev = evaluateCoa({ filename: FILE, product: raw.product ?? null, lotNo: raw.lotNo ?? null, items });
  return ev.rows.map((r) => ({ name: r.name, result: r.result, min: r.min, max: r.max }));
}
function rowsFromVision(raw: RawCoa): Row[] {
  const ev = evaluateCoa({ filename: FILE, product: raw.product ?? null, lotNo: raw.lotNo ?? null, items: raw.items ?? [] });
  return ev.rows.map((r) => ({ name: r.name, result: r.result, min: r.min, max: r.max }));
}

const VISION_PROMPT = `You are reading a Certificate of Analysis (COA) table from an image. Return ONLY valid JSON, no prose.
Schema: {"product":<str|null>,"lotNo":<str|null>,"items":[{"name":<str>,"unit":<str|null>,"method":<str|null>,"specRaw":<verbatim spec like "3 Max","15~45","270~350"|null>,"specMin":<num|null>,"specMax":<num|null>,"result":<measured value; if an Average/Mean column exists use THAT number>}]}
Rules: output EVERY test row. For a row with several measurement numbers followed by an Average, result = the Average. specRaw = the single printed spec token only. Never move a result into the spec. Never invent digits.`;

async function visionParse(model: string, b64: string): Promise<RawCoa | null> {
  try {
    const res = await axios.post(
      process.env.OLLAMA_URL || "http://localhost:11434/api/generate",
      { model, prompt: VISION_PROMPT, images: [b64], stream: false, format: "json", keep_alive: "5m", options: { temperature: 0 } },
      { timeout: 300_000 }
    );
    const raw = res.data.response;
    const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed as RawCoa;
  } catch (e: any) {
    console.error(`  [vision ${model}] failed:`, e?.message ?? e);
    return null;
  }
}

async function runModel(name: string, get: () => Promise<Row[] | null>) {
  console.log(`\n### ${name} (N=${N}) ###`);
  const fulls: number[] = [];
  let bestDetail: string[] = [];
  let best = -1;
  for (let i = 0; i < N; i++) {
    const rows = await get();
    if (!rows) { console.log(`  run${i + 1}: NULL`); fulls.push(-1); continue; }
    const s = score(rows);
    fulls.push(s.fullOk);
    console.log(`  run${i + 1}: full=${s.fullOk}/5  result=${s.resultOk}/5  spec=${s.specOk}/5`);
    if (s.fullOk > best) { best = s.fullOk; bestDetail = s.detail; }
  }
  const valid = fulls.filter((x) => x >= 0);
  const avg = valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : "n/a";
  const stable = new Set(valid).size <= 1;
  console.log(`  => full avg=${avg}/5  best=${best}/5  stable=${stable}`);
  console.log(`  best-run detail:`);
  bestDetail.forEach((d) => console.log(d));
  return { name, avg, best, stable };
}

async function main() {
  console.log(`Bake-off on ${FILE} — N=${N} runs/model\n${"=".repeat(70)}`);

  console.log("extracting OCR text once (text path input)…");
  const { text, engine } = await extractText(FILE);
  console.log(`OCR engine=${engine}, ${text.length} chars`);

  // vision input: ภาพ rotated ให้ตั้งตรง (RapidOCR ตรวจว่าเอียง 90°)
  console.log("preparing upright image for vision (rotate 90°)…");
  const buf = await new ImageProcessingService().preprocess(path.resolve(FILE), 90);
  const b64 = buf.toString("base64");

  const summary: any[] = [];
  for (const m of ["qwen2.5:3b-instruct", "qwen2.5:7b-instruct"]) {
    summary.push(await runModel(`text:${m}`, async () => {
      process.env.OLLAMA_MODEL = m;
      const raw = await new OllamaCoaService().parseCoa(text);
      return raw ? rowsFromText(raw, text) : null;
    }));
  }
  summary.push(await runModel("vision:qwen2.5vl:3b", async () => {
    const raw = await visionParse("qwen2.5vl:3b", b64);
    return raw ? rowsFromVision(raw) : null;
  }));

  console.log(`\n${"=".repeat(70)}\nSUMMARY (full = result+spec both correct, /5)`);
  for (const s of summary) console.log(`  ${s.name.padEnd(26)} avg=${s.avg}/5  best=${s.best}/5  stable=${s.stable}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
