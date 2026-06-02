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

export class OllamaCoaService {
  private readonly generateUrl =
    process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
  private readonly model = process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct";

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
      "result":  "<measured value; if an Avg/Mean column exists use THAT number>"
    }
  ]
}

Rules:
- Output EVERY test row that has a specification. Never skip or merge rows. Copy specRaw and result VERBATIM — do not reformat or compute.
- Items are test-table rows only. Skip headers, addresses, signatures, notes, stamps (ACCEPT/REJECT/"By: ...").
- "X Max" / "X Min" (e.g. "3 Max", "99 Min") is a SPEC → put the whole phrase in specRaw, never in unit.
- result and spec are DIFFERENT columns — never put the result number inside specRaw.
- NEVER build a spec range out of the result. specMin/specMax/specRaw hold ONLY the printed limit(s). If a limit is missing, leave it null — do not fill it with the measured value (e.g. result 69.11 with limit 80.0 is "≤80.0" or specMax 80.0, NEVER "69.11~80.0").
- NEVER use a lot/batch/PO number (usually 6+ digits, no decimal) as a spec or result value.
- Numbers separated by spaces are SEPARATE values (OCR artifact): "1 4 23" is 1, 4, 23 — do NOT join into "423". Pick one token; never invent digits.
- If a result is non-numeric (e.g. "White", a formula), copy it verbatim — do not force a number.

COA Text:
${text}
`.trim();

    try {
      const response = await axios.post(
        this.generateUrl,
        {
          model: this.model,
          // system role: qwen2.5-instruct เชื่อฟัง system message แรงกว่า rule ใน prompt เดี่ยว
          //   ตอกย้ำ 2 บาปหลักที่เคยเจอ — ปั้นเลข + ย้าย result ไปช่อง spec (fabricated-PASS)
          system:
            "You are a precise COA data-extraction engine. Output ONLY valid JSON matching the schema. Copy every value verbatim from its own column. Never invent a number and never move a measured result into a spec column.",
          prompt,
          stream: false,
          format: "json",
          keep_alive: 0,
          // num_ctx 8192: ตาราง COA ใหญ่ (หลายหน้า/หลายแถว) เกิน 4096 tokens → โมเดล truncate ท้าย = หล่นแถวท้าย
          //   qwen2.5:3b รองรับ 32k, 8192 ราคาถูกบน 3b — กัน silent truncation. temp 0 = deterministic
          options: { temperature: 0, num_ctx: 8192 },
        },
        { timeout: 300_000 }
      );
      const raw = response.data.response;
      dumpOllamaRaw(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2));
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed as RawCoa;
    } catch (error: any) {
      console.error("[ollama-coa] parse failed:", error?.message ?? error);
      return null;
    }
  }
}
