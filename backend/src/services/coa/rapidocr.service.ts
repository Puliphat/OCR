// Bridge ไป Python OCR sidecar (RapidOCR daemon) — แทน Tesseract สำหรับ COA scan
// daemon: ocr-py/ocr_server.py บน :8765 (start แยกเหมือน Ollama — `npm run ocr:daemon`)
// อ่านเลข/ตาราง COA แม่นกว่า Tesseract มาก (± ≥ ทศนิยมไม่เพี้ยน, multi-column ติด)
// CPU onnxruntime ~300MB → ไม่ชน memory wall แบบ vision LLM 3B
// ถ้า daemon ล่ม/unreachable → คืน null ให้ pipeline fall back ไป Tesseract
import axios from "axios";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ImageProcessingService } from "../image-processing.service";

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
    // ★ ส่ง absolute path เสมอ ★ — daemon resolve relative path ตาม cwd ของตัวเอง (มัก != backend/)
    //   relative + cwd ผิด → RapidOCR หาไฟล์ไม่เจอ → throw → HTTP 500 (เคยทำ corpus พังเงียบ, วินิจฉัยยาก)
    const abs = path.resolve(imagePath);
    try {
      const res = await axios.post(
        `${this.url}/ocr`,
        { path: abs },
        { timeout: 300_000 }
      );
      if (res.data?.error) {
        console.error("[rapidocr] daemon returned error:", res.data.error);
        return null;
      }
      return (res.data?.tokens as OcrToken[]) ?? [];
    } catch (e: any) {
      // แยก 2 กรณีให้ชัด (เดิม log "unreachable" ทั้งคู่ → ชี้นำผิดทาง):
      //  • มี e.response = daemon ติดต่อได้ แต่ตอบ error (เช่น 500 เปิดไฟล์ไม่ได้) → ปัญหาที่ path/ไฟล์
      //  • ไม่มี response = daemon ล่ม/ไม่ได้ start (ECONNREFUSED ฯลฯ) → ต้อง start daemon
      if (e?.response) {
        const detail =
          e.response.data?.error ?? e.response.statusText ?? e.message;
        console.error(
          `[rapidocr] daemon REACHABLE but errored (HTTP ${e.response.status}) on "${abs}": ${detail}`
        );
      } else {
        console.warn(
          `[rapidocr] daemon UNREACHABLE (${e?.code ?? e?.message ?? e}) — start it: \`npm run ocr:daemon\` from backend/`
        );
      }
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

  // นับ token "สูง-แคบ" (h>w*1.5 = ตัวอักษรตะแคง) vs "กว้าง-เตี้ย" (w>h*1.5 = อ่านตรง)
  // สแกนหมุน 90/270° → ตัวอักษรเป็นแนวตั้ง → tall เยอะ → OCR อ่านพัง
  private orientationStats(tokens: OcrToken[]): { tall: number; wide: number } {
    let tall = 0;
    let wide = 0;
    for (const t of tokens) {
      const w = t.x2 - t.x;
      const h = t.y2 - t.y1;
      if (w <= 0 || h <= 0) continue;
      if (h > w * 1.5) tall++;
      else if (w > h * 1.5) wide++;
    }
    return { tall, wide };
  }

  // ★ Rotation auto-correct ★ — สแกนหมุน 90/270° ทำ RapidOCR อ่านตัวอักษรตะแคง → เลข/spec เพี้ยน
  //   ตรวจจาก aspect ratio ของ box (tall เยอะ = หมุน) แล้วลอง OCR ภาพหมุน 90/270 เลือกมุมที่ "อ่านตรง"
  //   (wide เยอะสุด, tie-break ด้วย mean score) → คืน tokens ของมุมที่ดีที่สุด
  //   ★ Fast-path ★: ไฟล์ไม่หมุน (wide-dominant) คืน tokens เดิมทันที — output เท่าเดิมเป๊ะ, ไม่ OCR ซ้ำ
  private async correctRotation(
    imagePath: string,
    tokens0: OcrToken[]
  ): Promise<OcrToken[]> {
    const s0 = this.orientationStats(tokens0);
    // gate แบบ conservative: ต้อง tall มากและเยอะกว่า wide ชัดเจน ถึงจะถือว่าหมุน
    if (!(s0.tall >= 5 && s0.tall > s0.wide * 1.5)) return tokens0;

    const proc = new ImageProcessingService();
    const base = path.basename(imagePath).replace(/[^\w.-]/g, "_");
    const meanScore = (toks: OcrToken[]) =>
      toks.length ? toks.reduce((a, t) => a + t.score, 0) / toks.length : 0;

    const candidates: { angle: number; toks: OcrToken[]; wide: number; score: number }[] = [
      { angle: 0, toks: tokens0, wide: s0.wide, score: meanScore(tokens0) },
    ];

    for (const angle of [90, 270]) {
      let tmpFile = "";
      try {
        const buf = await proc.preprocess(imagePath, angle);
        tmpFile = path.join(os.tmpdir(), `rapidocr-rot-${base}-${angle}.png`);
        fs.writeFileSync(tmpFile, buf);
        const toks = await this.ocrTokens(tmpFile);
        if (toks && toks.length) {
          const st = this.orientationStats(toks);
          candidates.push({ angle, toks, wide: st.wide, score: meanScore(toks) });
        }
      } catch (e: any) {
        console.warn(`  [rapidocr] rotate ${angle}° failed:`, e?.message ?? e);
      } finally {
        if (tmpFile) {
          try {
            fs.unlinkSync(tmpFile);
          } catch {
            /* ignore temp cleanup */
          }
        }
      }
    }

    // เลือกมุมที่อ่านตรงสุด: wide มากสุด, เท่ากันใช้ mean score
    candidates.sort((a, b) => b.wide - a.wide || b.score - a.score);
    const best = candidates[0];
    if (best.angle !== 0) {
      console.log(
        `  [rapidocr] rotated scan → corrected ${best.angle}° (wide ${best.wide}↑ vs ${s0.wide}, score ${best.score.toFixed(3)})`
      );
    }
    return best.toks;
  }

  // convenience: รูป → text block; null ถ้า daemon ล่ม
  async extractText(imagePath: string): Promise<string | null> {
    const toks = await this.ocrTokens(imagePath);
    if (toks == null) return null;
    const best = await this.correctRotation(imagePath, toks);
    return this.reconstructText(best);
  }
}
