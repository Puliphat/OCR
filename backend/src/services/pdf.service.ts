import * as fs from "fs";
import * as path from "path";

const pdfjsDistPath = path.dirname(
  require.resolve("pdfjs-dist/package.json")
);

export class PdfService {
  // PDF → PNG (เฉพาะหน้า 1) — ใช้เมื่อ text-layer ใช้ไม่ได้ ก่อนส่งเข้า Tesseract
  // scale = 2000/baseWidth → resize ภาพเป็นกว้าง 2000px เพื่อให้ Tesseract อ่านชัด
  async convertToImage(filePath: string): Promise<string[]> {
    try {
      console.log(`Converting PDF to image: ${filePath}`);

      const { getDocument } = await import(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );

      const data = new Uint8Array(fs.readFileSync(filePath));
      const loadingTask = getDocument({
        data,
        cMapUrl: path.join(pdfjsDistPath, "cmaps/"),
        cMapPacked: true,
        standardFontDataUrl: path.join(pdfjsDistPath, "standard_fonts/"),
      });

      const pdfDocument = await loadingTask.promise;
      const page = await pdfDocument.getPage(1);

      const baseViewport = page.getViewport({ scale: 1 });
      const scale = 2000 / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvasFactory = (pdfDocument as any).canvasFactory;
      const canvasAndContext = canvasFactory.create(
        viewport.width,
        viewport.height
      );

      await page.render({
        canvasContext: canvasAndContext.context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const imageBuffer = canvasAndContext.canvas.toBuffer("image/png");
      const imagePath = filePath.replace(/\.pdf$/i, ".png");

      fs.writeFileSync(imagePath, imageBuffer);

      page.cleanup();
      await pdfDocument.destroy();

      console.log(`PDF converted to image: ${imagePath}`);
      return [imagePath];
    } catch (error) {
      console.error("Failed to convert PDF to image", error);
      throw error;
    }
  }
}
