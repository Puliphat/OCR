import sharp = require("sharp");

export class ImageProcessingService {
  // Preprocess รูปก่อนส่ง Tesseract — return Buffer (ไม่เซฟไฟล์ ลด clutter ใน uploads/)
  // rotation: หมุนภาพก่อน preprocess (0/90/180/270) — ใช้คู่กับ multi-rotation OCR ใน coa-pipeline
  // normalize() เพิ่ม contrast — ช่วยอ่านตัวอักษรเก่า/จาง
  async preprocess(filePath: string, rotation = 0): Promise<Buffer> {
    let pipeline = sharp(filePath);
    if (rotation !== 0) pipeline = pipeline.rotate(rotation);
    return pipeline
      .grayscale()
      .resize({ width: 2000, withoutEnlargement: false })
      .normalize()
      .sharpen()
      .toBuffer();
  }

  async metadata(filePath: string) {
    return sharp(filePath).metadata();
  }
}
