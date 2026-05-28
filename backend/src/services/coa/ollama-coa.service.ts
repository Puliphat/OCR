import axios from "axios";
import * as fs from "fs";

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

  async extractTextFromImage(imagePath: string): Promise<string | null> {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");
      const response = await axios.post(
        this.chatUrl,
        {
          model: this.ocrModel,
          messages: [
            {
              role: "user",
              content:
                "Extract all text from this Certificate of Analysis image. Preserve table structure with consistent column separators. Output the raw text only.",
              images: [base64Image],
            },
          ],
          stream: false,
        },
        { timeout: 180_000 }
      );
      return response.data.message?.content || response.data.response || null;
    } catch (error: any) {
      console.error("[ollama-coa] OCR failed:", error?.message ?? error);
      return null;
    }
  }

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
- For "≤ 0.2", "≦ 0.2", "0.5 Max." → put verbatim in "specRaw".
- For "≥ 50", "99.2 Min." → put verbatim in "specRaw".
- For the result column, when multiple batch statistic columns exist (Avg, Min, Max, Std), USE THE Avg (or Mean) NUMBER as "result". If no Avg/Mean column exists but there are multiple numbers, return them as a comma-separated string.
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
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed as RawCoa;
    } catch (error: any) {
      console.error("[ollama-coa] parse failed:", error?.message ?? error);
      return null;
    }
  }
}
