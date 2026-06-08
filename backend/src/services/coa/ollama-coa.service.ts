// Bridge ไปคุย Ollama — parse text COA → JSON (OCR ทำที่ RapidOCR sidecar/Tesseract แล้ว)
// ★ Prompt ของ parseCoa อยู่ที่นี่ ★ — ปรับ rules / schema ที่นี่เมื่อ LLM parse พลาด
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

// Debug dump ของ raw Ollama response — overwrite ทุก run
// ดูได้ที่ backend/coa-logs/_last-ollama.txt เพื่อ debug parse fail
const DEBUG_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "coa-logs",
  "_last-ollama.txt"
);
function dumpOllamaRaw(content: string) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_PATH), { recursive: true });
    fs.writeFileSync(DEBUG_PATH, content, "utf8");
  } catch {
    /* ignore — debug only */
  }
}

export interface RawCoaItem {
  name?: string | null;
  unit?: string | null;
  method?: string | null;
  specRaw?: string | null;
  specMin?: string | number | null;
  specMax?: string | number | null;
  result?: string | number | { avg?: number; min?: number; max?: number } | null;
}

export interface RawCoa {
  product?: string | null;
  lotNo?: string | null;
  items: RawCoaItem[];
}

// process-global: พอ GPU runner crash ครั้งแรก (VRAM ไม่พอ → CUDA error) → ข้าม GPU ทุก call ถัดไป
//   กันเสียเวลา crash ซ้ำทั้ง batch. reset เมื่อ restart process (ไม่ auto-recover ถ้า VRAM ว่างทีหลัง)
let gpuDisabled = false;

// สำหรับ A/B harness เท่านั้น — เคลียร์ latch ระหว่างเปลี่ยน model ไม่ให้ crash ของตัวหนึ่งลาก backend ตัวถัดไป
export function resetGpuState(): void {
  gpuDisabled = false;
}

export class OllamaCoaService {
  private readonly generateUrl =
    process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
  // default = qwen3:4b: pilot บน 16-file corpus (_validate/_pilot-qwen3.log) — เร็วกว่า 7b 2.6x
  //   (10s vs 27s/file) เพราะ ~2.8GB fit GPU จริง (7b 4.7GB ตก CPU-fallback บนเครื่องนี้),
  //   abstain มากกว่า (honest SKIP > confident-wrong ตาม Priority #1), StructEval สูงกว่า 7b.
  //   raw 4b ยัง mis-associate บางแถว → guard เต็ม pipeline (drop/fail/pass-guard) จับเป็น SKIP.
  //   qwen3 = reasoning model → ต้อง think:false (ดู makeBody). override ด้วย OLLAMA_MODEL ได้
  private readonly model = process.env.OLLAMA_MODEL || "qwen3:4b";

  // debug: raw JSON ของ run ล่าสุด (pipeline หยิบไปแนบ CoaReport.debug.llmRaw)
  public lastRawResponse: string | null = null;
  public get modelName(): string {
    return this.model;
  }

  // ส่ง text COA ให้ LLM → คืน JSON shape { product, lotNo, items[] }
  // ปรับ prompt เมื่อเจอใบแบบใหม่ที่ parse ไม่เข้า / เพิ่ม field — temperature=0, format=json บังคับให้ deterministic
  async parseCoa(text: string): Promise<RawCoa | null> {
    // Prompt สั้น/clean (≈22 บรรทัด) — โมเดลเล็ก (qwen2.5:3b) ทำงานดีกว่าเมื่อ rule กระชับ
    // เก็บ rule ความปลอดภัยครบ: ห้ามรวมเลข, ห้ามเอา lot เป็น spec, "X Max"=spec, ห้ามปั้นค่า
    // ★ key fix ★ "Output EVERY row that has a spec" → กัน LLM ทิ้งแถว (Z99/Inolob)
    const prompt = `
You are parsing a Certificate of Analysis (COA). Return ONLY valid JSON, no prose, no markdown.

Schema:
{
  "product": "<product name or null>",
  "lotNo":   "<lot/batch number or null>",
  "items": [
    {
      "name":    "<parameter name>",
      "unit":    "<unit (g/l, %, μm, °C…) or null>",
      "method":  "<test method or null>",
      "specRaw": "<spec verbatim if in ONE cell: 275-425, 40~70, 26 ± 2, ≤0.2, 3 Max, 99 Min — else null>",
      "specMin": "<lower limit if a SEPARATE Min/Lower column exists, else null>",
      "specMax": "<upper limit if a SEPARATE Max/Upper column exists, else null>",
      "result":  "<measured value; if an Avg/Mean column exists use THAT number; null if you cannot read it confidently>"
    }
  ]
}

Rules:
- Output EVERY test row that has a specification. Never skip or merge rows. Copy specRaw and result VERBATIM — do not reformat or compute.
- ★ ONE LINE = ONE ROW ★ Each line of COA Text is a single test row. A row's specRaw and result MUST come ONLY from numbers on that SAME line. NEVER borrow a number from a different line into this row — that is the most common and most dangerous error.
- specRaw is a SINGLE spec token only (e.g. "3 Max", "15~45", "≤0.2", "270~350"). Do NOT concatenate other cells, other rows' numbers, or words like "Success"/"Pass" into specRaw.
- If a row lists several measurement numbers followed by an Average/Mean (often the number just BEFORE the spec), use that Average as result — not an individual measurement.
- Items are test-table rows only. Skip headers, addresses, signatures, notes, stamps (ACCEPT/REJECT/"By: ...").
- "X Max" / "X Min" (e.g. "3 Max", "99 Min") is a SPEC → put the whole phrase in specRaw, never in unit.
- result and spec are DIFFERENT columns — never put the result number inside specRaw.
- NEVER build a spec range out of the result. specMin/specMax/specRaw hold ONLY the printed limit(s). If a limit is missing, leave it null — do not fill it with the measured value (e.g. result 69.11 with limit 80.0 is "≤80.0" or specMax 80.0, NEVER "69.11~80.0").
- NEVER use a lot/batch/PO number (usually 6+ digits, no decimal) as a spec or result value.
- Numbers separated by spaces are SEPARATE values (OCR artifact): "1 4 23" is 1, 4, 23 — do NOT join into "423". Pick one token; never invent digits.
- If a result is non-numeric (e.g. "White", a formula), copy it verbatim — do not force a number.
- ★ ABSTAIN, NEVER GUESS ★ If a cell is blank, unreadable, or you are not sure which number belongs to THIS row, output null for that field. Do NOT guess and do NOT copy a value from a neighbouring row or column. A null (which becomes an honest SKIP) is ALWAYS better than a confident wrong number — wrong numbers that happen to land inside a spec produce deceptive PASS/FAIL, the single worst failure of this system.
- Some COA formats include a Judgement or Pass/Fail column at the far right, AFTER the Result column. Its values are letters O (= pass) / X (= fail), the digit 0 (OCR of letter O), or words Passed/Failed/ACCEPT/REJECT. IGNORE this column — it records a QA decision, not a measured value. When a row ends in such a judgement symbol after a numeric result, that preceding numeric value is the result.
- Row sequence numbers (1, 2, 3, 4…) printed at the start or left edge of a table row identify test order only. They are NOT result, spec, or unit values. Never use them for result.

COA Text:
${text}
`.trim();

    // qwen3 = reasoning model: default thinking ON → ช้า + เปลือง ctx. งาน extraction ตรงๆ ไม่ต้อง reason
    //   → ปิด think (เฉพาะ qwen3*; qwen2.5 ไม่มี param นี้ ถ้าใส่อาจ error). format:"json" ไม่ใช่ json-schema
    //   → เลี่ยง Ollama bug #15260 (think=false + json-schema = drop format เงียบๆ)
    const isQwen3 = /qwen3/i.test(this.model);
    const makeBody = (extra: Record<string, unknown>) => ({
      model: this.model,
      // system role: qwen2.5-instruct เชื่อฟัง system message แรงกว่า rule ใน prompt เดี่ยว
      //   ตอกย้ำ 2 บาปหลักที่เคยเจอ — ปั้นเลข + ย้าย result ไปช่อง spec (fabricated-PASS)
      system:
        "You are a precise COA data-extraction engine. Output ONLY valid JSON matching the schema. Copy every value verbatim from its own column. Never invent a number and never move a measured result into a spec column.",
      prompt,
      stream: false,
      format: "json",
      keep_alive: 0,
      ...(isQwen3 ? { think: false } : {}),
      // num_ctx 8192: ตาราง COA ใหญ่ (หลายหน้า/หลายแถว) เกิน 4096 tokens → โมเดล truncate ท้าย = หล่นแถวท้าย
      //   8192 กัน silent truncation. temp 0 = deterministic. ...extra = ใส่ num_gpu:0 ตอน fallback CPU
      options: { temperature: 0, num_ctx: 8192, ...extra },
    });

    // ★ GPU→CPU fallback ★ — 7b (4.7GB) มัก crash บน GPU ที่ VRAM น้อย (CUDA runner terminated)
    //   ลอง GPU ก่อน (เร็ว); ถ้า crash เพราะ VRAM → retry CPU (num_gpu:0) ช้าแต่ไม่พัง
    //   พอ GPU พังครั้งแรก ตั้ง gpuDisabled → call ถัดไปข้าม GPU เลย (ไม่เสียเวลา crash ซ้ำทั้ง batch)
    type Attempt = { label: "gpu" | "cpu"; extra: Record<string, unknown>; timeout: number };
    const attempts: Attempt[] = gpuDisabled
      ? [{ label: "cpu", extra: { num_gpu: 0 }, timeout: 300_000 }]
      : [
          { label: "gpu", extra: {}, timeout: 120_000 },
          { label: "cpu", extra: { num_gpu: 0 }, timeout: 300_000 },
        ];

    let lastErr = "";
    for (const a of attempts) {
      try {
        const response = await axios.post(this.generateUrl, makeBody(a.extra), {
          timeout: a.timeout,
        });
        const raw = response.data.response;
        const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
        // GPU runner ที่ตายกลางคันบางทีตอบ HTTP 200 + response ว่าง/ถูกตัด (ไม่ใช่ 500) →
        //   ถ้าไม่ดักจะตก JSON.parse fail → return null โดยไม่ลอง CPU (silent miss เคส VRAM พอดี)
        if (a.label === "gpu" && !rawStr.trim()) {
          gpuDisabled = true;
          lastErr = "empty GPU response (runner likely died)";
          console.warn(`[ollama-coa] GPU returned empty → retry on CPU (num_gpu:0)`);
          continue;
        }
        this.lastRawResponse = rawStr;
        dumpOllamaRaw(rawStr);
        const parsed = JSON.parse(rawStr);
        if (!parsed || !Array.isArray(parsed.items)) return null;
        return parsed as RawCoa;
      } catch (error: any) {
        lastErr = error?.response?.data?.error ?? error?.message ?? String(error);
        // retry บน CPU เฉพาะตอน GPU attempt พังด้วย signal จริงของ VRAM/runner/timeout
        //   regex แคบ (เลี่ยง false-positive จาก "gpu"/"system memory" ลอยๆ ใน 400/รายงานอื่น)
        //   CPU retry ตอน GPU พังปลอดภัยเสมอ. ไม่ retry: JSON พัง / 400 / ECONNREFUSED (CPU ก็แก้ไม่ได้)
        const gpuRetriable =
          a.label === "gpu" &&
          /cuda|llama runner|runner process|terminated|out of memory|timeout|etimedout/i.test(
            lastErr
          );
        if (gpuRetriable) {
          gpuDisabled = true;
          console.warn(
            `[ollama-coa] GPU attempt failed (${lastErr.slice(0, 90)}) → retry on CPU (num_gpu:0)`
          );
          continue;
        }
        console.error(`[ollama-coa] ${a.label} parse failed:`, lastErr);
        return null; // error อื่น CPU ก็แก้ไม่ได้
      }
    }
    // ถึงตรงนี้ได้เฉพาะกรณี GPU พัง→ตก CPU แต่ array หมด (กันพลาด — ปกติ return ในลูป)
    console.error(`[ollama-coa] parse failed (all attempts): ${lastErr}`);
    return null;
  }
}
