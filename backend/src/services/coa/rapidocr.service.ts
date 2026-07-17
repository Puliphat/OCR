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
  // hq=true → daemon ใช้ HQ engine (v5-server, lazy-load) สำหรับ scanned page ที่อ่านเพี้ยน
  async ocrTokens(imagePath: string, hq = false): Promise<OcrToken[] | null> {
    // ★ ส่ง image เป็น bytes (base64) เสมอ ★ — daemon อาจอยู่คนละเครื่อง (LAN deploy) →
    //   เอื้อมถึง disk ของ backend ไม่ได้. path ยังส่งไปด้วยเพื่อ log/error เท่านั้น
    //   (daemon เลือก b64 ก่อน, ไม่มี b64 ค่อย fall back อ่าน path = same-machine back-compat).
    //   เดิมส่งแค่ path → daemon os.path.exists() เปิดจาก disk ตัวเอง → เครื่องอื่นหาไฟล์ไม่เจอ
    //   → HTTP 500 → pipeline fall back Tesseract เงียบ (corpus เพี้ยนไม่รู้ตัว)
    const abs = path.resolve(imagePath);
    let imageB64: string;
    try {
      imageB64 = fs.readFileSync(abs).toString("base64");
    } catch (e: any) {
      console.error(`[rapidocr] cannot read image "${abs}": ${e?.message ?? e}`);
      return null;
    }
    try {
      const res = await axios.post(
        `${this.url}/ocr`,
        { path: abs, image_b64: imageB64, hq },
        { timeout: 300_000, maxBodyLength: Infinity, maxContentLength: Infinity }
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
    tokens0: OcrToken[],
    hq = false
  ): Promise<{ tokens: OcrToken[]; angle: number }> {
    const s0 = this.orientationStats(tokens0);
    // gate แบบ conservative: ต้อง tall มากและเยอะกว่า wide ชัดเจน ถึงจะถือว่าหมุน
    if (!(s0.tall >= 5 && s0.tall > s0.wide * 1.5)) return { tokens: tokens0, angle: 0 };

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
        const toks = await this.ocrTokens(tmpFile, hq);
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
    return { tokens: best.toks, angle: best.angle };
  }

  // post-rotation tokens (public — ใช้ทั้ง extractText และ dev harness เทียบ reconstruct)
  // hq=true → HQ engine (v5-server) ทั้ง OCR หลัก + รอบ rotation candidate
  async getProcessedTokens(imagePath: string, hq = false): Promise<{ tokens: OcrToken[]; angle: number } | null> {
    const toks = await this.ocrTokens(imagePath, hq);
    if (toks == null) return null;
    return this.correctRotation(imagePath, toks, hq);
  }

  // convenience: รูป → text block; null ถ้า daemon ล่ม
  async extractText(imagePath: string): Promise<string | null> {
    const result = await this.getProcessedTokens(imagePath);
    if (result == null) return null;
    return this.reconstructText(result.tokens);
  }

  // ★ grid→LLM (A/B-gated) ★ — คืนทั้ง flat (เดิม, ป้อน guard) + grid (column-aware, ป้อน LLM)
  //   จาก OCR pass เดียว (getProcessedTokens ครั้งเดียว → ไม่ OCR ซ้ำ). null ถ้า daemon ล่ม
  async extractTextBoth(
    imagePath: string,
    hq = false
  ): Promise<{ flat: string; grid: string; tokens: OcrToken[]; correctionAngle: number } | null> {
    const result = await this.getProcessedTokens(imagePath, hq);
    if (result == null) return null;
    const { tokens, angle } = result;
    return {
      flat: this.reconstructText(tokens),
      grid: this.reconstructTextGrid(tokens),
      tokens,
      correctionAngle: angle,
    };
  }

  // ★ column-aware reconstruct (experimental) ★ — cluster token left-edge (x) เป็น column band
  //   ทั้งหน้า แล้ววางแต่ละ token ลง column ของมัน → row ที่ cell หาย (sparse) คงตำแหน่ง column
  //   (เติม cell ว่าง) → LLM map spec/result/ป้าย ไม่กำกวม. ยังไม่ใช้ใน production จนกว่า A/B ผ่าน corpus
  reconstructTextGrid(tokens: OcrToken[], opts?: { colGapMul?: number }): string {
    if (!tokens.length) return "";
    const colGapMul = opts?.colGapMul ?? 1.5;

    const heights = tokens.map((t) => t.y2 - t.y1).filter((h) => h > 0).sort((a, b) => a - b);
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
    const rowGap = Math.max(8, 0.6 * medianH);

    // 1) group เป็นแถวตาม y
    const sorted = [...tokens].sort((a, b) => a.y - b.y);
    const rows: OcrToken[][] = [];
    let cur: OcrToken[] = [sorted[0]];
    let lastY = sorted[0].y;
    for (const t of sorted.slice(1)) {
      if (Math.abs(t.y - lastY) > rowGap) {
        rows.push(cur);
        cur = [];
      }
      cur.push(t);
      lastY = t.y;
    }
    if (cur.length) rows.push(cur);

    // 2) column bands: cluster left-edge (x) ทั้งหน้า — เริ่ม band ใหม่เมื่อ x ห่าง > colGap
    const colGap = Math.max(medianH * colGapMul, 16);
    const xs = tokens.map((t) => t.x).sort((a, b) => a - b);
    const bandEdges: number[] = [xs[0]];
    let prev = xs[0];
    for (const x of xs.slice(1)) {
      if (x - prev > colGap) bandEdges.push(x);
      prev = x;
    }

    const assignCol = (x: number): number => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < bandEdges.length; i++) {
        const d = Math.abs(x - bandEdges[i]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };

    // 3) วาง token ลง column, เติม cell ว่าง, ตัด trailing empty
    return rows
      .map((r) => {
        const cells: string[] = bandEdges.map(() => "");
        for (const t of [...r].sort((a, b) => a.x - b.x)) {
          const c = assignCol(t.x);
          cells[c] = cells[c] ? `${cells[c]} ${t.text}` : t.text;
        }
        let last = cells.length - 1;
        while (last >= 0 && cells[last] === "") last--;
        return cells.slice(0, last + 1).join("  |  ");
      })
      .join("\n");
  }
}
