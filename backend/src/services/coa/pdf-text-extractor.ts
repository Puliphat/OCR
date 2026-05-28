// ดึง text-layer จาก PDF โดยตรง (ใช้ pdfjs-dist) — ไม่ต้อง render เป็นภาพ + OCR
// PDF ส่วนใหญ่ที่ export จาก Word/Excel มี text-layer อยู่แล้ว ใช้ทางนี้เร็ว/แม่นกว่ามาก
import * as fs from "fs";
import * as path from "path";

const pdfjsDistPath = path.dirname(
  require.resolve("pdfjs-dist/package.json")
);

export interface PdfTextResult {
  text: string;
  hasUsableText: boolean;
  pageCount: number;
}

// อ่านทุกหน้า เรียงเป็น line ตาม Y-coordinate (Δy > 2 = ขึ้นบรรทัดใหม่)
// hasUsableText = true เมื่อข้อความ (ไม่นับช่องว่าง) ≥ 100 chars — ไม่ถึงถือว่า scanned ต้อง fallback OCR
export async function extractPdfText(filePath: string): Promise<PdfTextResult> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await getDocument({
    data,
    cMapUrl: path.join(pdfjsDistPath, "cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfjsDistPath, "standard_fonts/"),
    useSystemFonts: true,
  }).promise;

  const allLines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let buf: string[] = [];
    let lastY: number | null = null;
    for (const item of tc.items as any[]) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (buf.length) allLines.push(buf.join(" "));
        buf = [];
      }
      buf.push(item.str);
      lastY = y;
    }
    if (buf.length) allLines.push(buf.join(" "));
    page.cleanup();
  }
  await doc.destroy();

  const text = allLines.filter((l) => l.trim()).join("\n");
  return {
    text,
    hasUsableText: text.replace(/\s/g, "").length >= 100,
    pageCount: doc.numPages,
  };
}
