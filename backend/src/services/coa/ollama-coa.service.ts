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
    const prompt = `
You are parsing a Certificate of Analysis (COA) / Quality Inspection Certificate.

Return ONLY valid JSON. No prose, no markdown fences.

Schema:
{
  "product": "<product name or null>",
  "lotNo":   "<lot/batch number or null>",
  "items": [
    {
      "name":     "<characteristic / parameter name>",
      "unit":     "<unit like g/l, %, μm, °C, or null>",
      "method":   "<test method or null>",
      "specRaw":  "<the spec string verbatim if shown in one cell, else null>",
      "specMin":  "<spec lower limit (number or string) if a separate Min column exists, else null>",
      "specMax":  "<spec upper limit (number or string) if a separate Max column exists, else null>",
      "result":   "<observed/measured value verbatim — if Avg/Mean column exists USE THAT NUMBER, else use the single result column>"
    }
  ]
}

Rules:
- Items live in the test/result table only. Do NOT include header rows, footers, addresses, signatures, or notes.
- If the spec is a range written in one cell (e.g. "275-425", "40.0 ~ 70.0", "26 ± 2"), put it in "specRaw" and leave specMin/specMax null.
- If the table has SEPARATE Min and Max spec columns, fill "specMin" and "specMax" and leave "specRaw" null.
- If the table has SEPARATE "Lower limit" and "Upper limit" columns, treat Lower=specMin and Upper=specMax.

- **Column header mapping**: If the table has explicit headers like "Min. Spec." / "Lower limit" → specMin, "Max. Spec." / "Upper limit" → specMax, "Actual Result(s)" / "Test result" → result, use those headers to assign columns for every following data row.

- **NEVER use lot/batch/PO numbers as spec values.** Lot/batch numbers are typically 6+ contiguous digits with no decimal (e.g. "72700403", "850996", "26031301"). If such a number appears in a data row's middle columns, treat it as a batch identifier — set "lotNo" but NEVER place it in specMin/specMax/result.
- Example: text row "280 72700403 180 250,00 200,00" under headers "Min | Batch no. | Result | Max | Min" → lotNo="72700403", result="180", specMax="250.00", specMin="200.00".

- For "≤ 0.2", "≦ 0.2", "0.5 Max." → put verbatim in "specRaw".
- For "≥ 50", "99.2 Min." → put verbatim in "specRaw".
- **"X Max." / "X Min." is a SPEC, not a unit.** When you see a number followed by "Max" or "Min" (with/without period), the whole phrase is the spec range — put it in specRaw. Do NOT put "Max"/"Min" alone in unit field.
- For the result column, when multiple batch statistic columns exist (Avg, Min, Max, Std), USE THE Avg (or Mean) NUMBER as "result". If no Avg/Mean column exists but there are multiple measurement numbers, USE THE LAST NUMBER before the spec range — that is usually the Avg or final reading on a COA.
- **CRITICAL: "result" and "specRaw" come from DIFFERENT columns. NEVER include the result number inside specRaw.** specRaw must contain ONLY the spec range/limit (e.g. "15-45", "3 Max", "270~350") — strip out any leading number that is actually the Avg/result.
- **CRITICAL: NEVER concatenate digits separated by whitespace.** OCR often splits a single number into space-separated tokens (e.g. "1 4 23" is THREE separate measurements 1, 4, 23 — NOT the number 1423 or 423). Treat each whitespace-separated token as its own number.
- **Sanity check**: a valid "result" should be plausibly within the same order of magnitude as the spec. If spec is "15-45" and you produced result="423", you almost certainly concatenated digits — re-read and pick a single token in the right magnitude.
- The "|" character in OCR text usually marks a column boundary — split on it when determining which number is which column.
- Row structure on scanned COAs is usually: [item name] [individual measurement values] [Avg] [Spec range] [Status word like Success/Accept]. The LAST individual number before the spec-format is the result; the spec-format text after it is specRaw.
- Example: OCR row "Sieve Residue 1 4 23 | 15 -45 Success" → name="Sieve Residue", result="23", specRaw="15-45" (the LAST number 23 fits spec 15-45; "423" would be a wrong concatenation).
- Example: OCR row "Density 336 322 33s 329.0 | 270 ~350 Success" → name="Density", result="329.0", specRaw="270~350" (329.0 is clearly the Avg column, earlier numbers are individual measurements).
- Example: OCR row "Sieve Residue under 150% 1 : 2 i 1 | 1.3 . 20 Max Success" → name="Sieve Residue under 150%", result="1.3", specRaw="20 Max" (1.3 is the Avg between the "|" and the spec; "13" would be a wrong concatenation of "1" and ".3").
- Preserve units exactly. Do not invent units.
- Skip rows that have no result value at all.
- Skip stamp text such as "ACCEPT", "REJECT", "By: QA Dept." — these are post-scan annotations, not data.

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
