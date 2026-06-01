// Bridge ไปคุย Ollama — มี 2 mode: vision OCR (ไม่ได้ใช้ตอนนี้) + parse text → JSON
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
  private readonly chatUrl =
    process.env.OLLAMA_CHAT_URL || "http://localhost:11434/v1";
  private readonly model = process.env.OLLAMA_MODEL || "gemma3";
  private readonly ocrModel =
    process.env.OLLAMA_OCR_MODEL || "scb10x/typhoon-ocr-3b";

  // Vision OCR ผ่าน typhoon-ocr-3b — ใช้เมื่อ USE_TYPHOON_OCR=true ใน .env
  // ยิง Ollama native /api/chat (ไม่ใช่ /v1 OpenAI) เพราะ format messages.images[] เป็น Ollama native
  // keep_alive: 0 → ปล่อย model ออกจาก RAM ทันทีหลัง OCR เสร็จ (กิน RAM ~7.5GB ตอนรัน)
  async extractTextFromImage(imagePath: string): Promise<string | null> {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");
      const chatNativeUrl = this.generateUrl.replace(/\/generate$/, "/chat");
      const response = await axios.post(
        chatNativeUrl,
        {
          model: this.ocrModel,
          messages: [
            {
              role: "user",
              content:
                "Extract all text from this Certificate of Analysis image. Preserve table structure with whitespace/pipes between columns. Keep decimal points exactly as printed (e.g. write '42.3' not '423' or '4 23'). Output the raw text only — no commentary, no markdown.",
              images: [base64Image],
            },
          ],
          stream: false,
          keep_alive: 0,
        },
        { timeout: 600_000 }
      );
      return response.data.message?.content || null;
    } catch (error: any) {
      console.error("[ollama-coa] Typhoon OCR failed:", error?.message ?? error);
      return null;
    }
  }

  // ส่ง text COA ให้ gemma3 → คืน JSON shape { product, lotNo, items[] }
  // ปรับ prompt เมื่อเจอใบแบบใหม่ที่ parse ไม่เข้า / เพิ่ม field — temperature=0, format=json บังคับให้ deterministic
  async parseCoa(text: string): Promise<RawCoa | null> {
    // Prompt สั้น/clean (≈22 บรรทัด) — โมเดลเล็ก (gemma3/qwen2.5:3b) ทำงานดีกว่าเมื่อ rule กระชับ
    // เก็บ rule ความปลอดภัยครบ: ห้ามรวมเลข, ห้ามเอา lot เป็น spec, "X Max"=spec, ห้ามปั้นค่า
    // ★ key fix ★ "Output EVERY row that has a spec" → กัน qwen/gemma3 ทิ้งแถว (Z99/Inolob)
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
          prompt,
          stream: false,
          format: "json",
          keep_alive: 0,
          options: { temperature: 0, num_ctx: 4096 },
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
