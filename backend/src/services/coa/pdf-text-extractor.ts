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
