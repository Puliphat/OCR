// A/B harness: เทียบ gemma3 vs qwen2.5:3b-instruct บน "ข้อความเดียวกัน"
// ★ Fair test ★ — extract text ครั้งเดียวต่อไฟล์ แล้วป้อน text เดิมให้ทั้ง 2 โมเดล
//   (ถ้าปล่อยให้ OCR รันใหม่ต่อโมเดล ความ non-deterministic ของ Tesseract จะปนผล)
// รัน: npx ts-node src/scripts/ab-models.ts            (ทุกไฟล์ต้นฉบับใน uploads/)
//      npx ts-node src/scripts/ab-models.ts <file...>  (เฉพาะไฟล์)
import * as fs from "fs";
import * as path from "path";
import { extractText } from "../services/coa/coa-pipeline";
import { OllamaCoaService } from "../services/coa/ollama-coa.service";
import { recoverSpecsFromOcr } from "../services/coa/spec-recovery";
import { evaluateCoa } from "../services/coa/coa-evaluator";

const UPLOADS = path.join(__dirname, "..", "..", "uploads");
const MODELS = ["gemma3", "qwen2.5:3b-instruct"];

// เฉพาะไฟล์ต้นฉบับ (ไม่เอา timestamped / processed_ / .png ที่ render ไว้)
function originalFiles(): string[] {
  return fs
    .readdirSync(UPLOADS)
    .filter((f) => /^\d{8}_.*\.pdf$/i.test(f))
    .map((f) => path.join(UPLOADS, f));
}

async function runModelOnText(text: string, model: string, filename: string) {
  process.env.OLLAMA_MODEL = model; // OllamaCoaService อ่าน model จาก env ตอน construct
  const svc = new OllamaCoaService();
  const raw = await svc.parseCoa(text);
  if (!raw) return { pass: 0, fail: 0, skip: 0, total: 0, items: 0 };
  recoverSpecsFromOcr(raw.items ?? [], text);
  const ev = evaluateCoa({ filename, product: raw.product, lotNo: raw.lotNo, items: raw.items ?? [] });
  return { ...ev.summary, items: raw.items?.length ?? 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const targets = args.length ? args : originalFiles();

  const totals: Record<string, { pass: number; fail: number; skip: number; total: number }> = {};
  for (const m of MODELS) totals[m] = { pass: 0, fail: 0, skip: 0, total: 0 };

  console.log(`A/B: ${MODELS.join("  vs  ")}\n${"=".repeat(78)}`);
  console.log(`${"file".padEnd(38)} ${MODELS.map((m) => m.padEnd(17)).join(" ")}`);
  console.log("-".repeat(78));

  for (const f of targets) {
    const filename = path.basename(f);
    let text = "";
    try {
      text = await extractText(f); // ★ ครั้งเดียว ★
    } catch (e) {
      console.log(`${filename.slice(0, 37).padEnd(38)} extractText FAILED: ${(e as Error).message}`);
      continue;
    }
    const cells: string[] = [];
    for (const m of MODELS) {
      const s = await runModelOnText(text, m, filename);
      totals[m].pass += s.pass;
      totals[m].fail += s.fail;
      totals[m].skip += s.skip;
      totals[m].total += s.total;
      cells.push(`${s.pass}P/${s.fail}F/${s.skip}S`.padEnd(17));
    }
    console.log(`${filename.slice(0, 37).padEnd(38)} ${cells.join(" ")}`);
  }

  console.log("=".repeat(78));
  console.log(`${"TOTAL".padEnd(38)} ${MODELS.map((m) => {
    const t = totals[m];
    return `${t.pass}P/${t.fail}F/${t.skip}S`.padEnd(17);
  }).join(" ")}`);
  console.log(`(higher PASS + lower SKIP = better; แต่ระวัง FAIL ที่เพิ่มอาจเป็น spec อ่านผิด)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
