import * as fs from "fs";
import * as path from "path";

const pdfjsDistPath = path.dirname(
  require.resolve("pdfjs-dist/package.json")
);

export class PdfService {
  // PDF → PNG (ทุกหน้า) — ใช้เมื่อ text-layer ใช้ไม่ได้ ก่อนส่งเข้า OCR
  // scale = 2000/baseWidth (≈242dpi บน A4) — ค่าที่ validate มาแล้ว; เคยลอง 3000 แล้ว OCR บางไฟล์แย่ลง
  // คืน path รูปทุกหน้าตามลำดับ (1-indexed suffix .p1.png, .p2.png, …)
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
      const imagePaths: string[] = [];

      // destroy ใน finally — กัน leak doc handle ถ้า render หน้ากลาง throw
      // (render ทุกหน้าแล้ว โอกาสเจอหน้าพังกลางทางสูงกว่า path เดิมที่ทำหน้า 1 อย่างเดียว)
      try {
        for (let p = 1; p <= pdfDocument.numPages; p++) {
          const page = await pdfDocument.getPage(p);

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
          const imagePath = filePath.replace(/\.pdf$/i, `.p${p}.png`);

          fs.writeFileSync(imagePath, imageBuffer);

          page.cleanup();
          imagePaths.push(imagePath);
          console.log(`PDF page ${p}/${pdfDocument.numPages} converted to image: ${imagePath}`);
        }
      } finally {
        await pdfDocument.destroy();
      }

      console.log(`PDF converted to ${imagePaths.length} image(s)`);
      return imagePaths;
    } catch (error) {
      console.error("Failed to convert PDF to image", error);
      throw error;
    }
  }
}
