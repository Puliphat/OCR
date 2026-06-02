// Bridge ไป Python OCR sidecar (RapidOCR daemon) — แทน Tesseract สำหรับ COA scan
// daemon: ocr-py/ocr_server.py บน :8765 (start แยกเหมือน Ollama — `npm run ocr:daemon`)
// อ่านเลข/ตาราง COA แม่นกว่า Tesseract มาก (± ≥ ทศนิยมไม่เพี้ยน, multi-column ติด)
// CPU onnxruntime ~300MB → ไม่ชน memory wall แบบ vision LLM 3B
// ถ้า daemon ล่ม/unreachable → คืน null ให้ pipeline fall back ไป Tesseract
import axios from "axios";

export interface OcrToken {
  text: string;
  score: number;
  x: number; // left
  y: number; // vertical center
  y1: number; // top
  y2: number; // bottom
  x2: number; // right
}

export class RapidOcrService {
  private readonly url = process.env.OCR_SIDECAR_URL || "http://127.0.0.1:8765";

  // ยิงรูปไป daemon → tokens พร้อม box; null ถ้า daemon ล่ม (caller fall back)
  async ocrTokens(imagePath: string): Promise<OcrToken[] | null> {
    try {
      const res = await axios.post(
        `${this.url}/ocr`,
        { path: imagePath },
        { timeout: 300_000 }
      );
      if (res.data?.error) {
        console.error("[rapidocr] daemon error:", res.data.error);
        return null;
      }
      return (res.data?.tokens as OcrToken[]) ?? [];
    } catch (e: any) {
      console.warn("[rapidocr] daemon unreachable:", e?.message ?? e);
      return null;
    }
  }

  // tokens → text block: จัดเป็นแถวตาม y, เรียงซ้าย→ขวาตาม x, join ด้วย "  |  "
  // gap = 0.6 × median height → ปรับตาม DPI อัตโนมัติ, เก็บโครงตารางให้ LLM แยก column ได้
  reconstructText(tokens: OcrToken[]): string {
    if (!tokens.length) return "";

    const heights = tokens
      .map((t) => t.y2 - t.y1)
      .filter((h) => h > 0)
      .sort((a, b) => a - b);
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
    const gap = Math.max(8, 0.6 * medianH);

    const sorted = [...tokens].sort((a, b) => a.y - b.y);
    const rows: OcrToken[][] = [];
    let cur: OcrToken[] = [sorted[0]];
    let lastY = sorted[0].y;
    for (const t of sorted.slice(1)) {
      if (Math.abs(t.y - lastY) > gap) {
        rows.push(cur);
        cur = [];
      }
      cur.push(t);
      lastY = t.y;
    }
    if (cur.length) rows.push(cur);

    return rows
      .map((r) =>
        [...r]
          .sort((a, b) => a.x - b.x)
          .map((t) => t.text)
          .join("  |  ")
      )
      .join("\n");
  }

  // convenience: รูป → text block; null ถ้า daemon ล่ม
  async extractText(imagePath: string): Promise<string | null> {
    const toks = await this.ocrTokens(imagePath);
    if (toks == null) return null;
    return this.reconstructText(toks);
  }
}
