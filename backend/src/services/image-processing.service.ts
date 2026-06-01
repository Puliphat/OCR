import sharp = require("sharp");

export class ImageProcessingService {
  // Preprocess รูปก่อนส่ง Tesseract — return Buffer (ไม่เซฟไฟล์ ลด clutter ใน uploads/)
  // rotation: หมุนภาพก่อน preprocess (0/90/180/270) — ใช้คู่กับ multi-rotation OCR ใน coa-pipeline
  // normalize() เพิ่ม contrast — ช่วยอ่านตัวอักษรเก่า/จาง
  async preprocess(filePath: string, rotation = 0): Promise<Buffer> {
    let pipeline = sharp(filePath);
    if (rotation !== 0) pipeline = pipeline.rotate(rotation);
    // width 2000 = ค่าที่ validate มาแล้วบน 16 ไฟล์ (≈242dpi บน A4) — อย่าเปลี่ยนเดี่ยว ๆ
    // เคยลอง 3000 + median(1) แต่ Tesseract scaling ไม่ monotonic → density/350 row ของ Lot240521
    // เพี้ยนหนักขึ้น (270~350→"270 - ร 330"). ถ้าจะดันขึ้นต้อง A/B ทั้ง batch ก่อน (ดู skeptic note)
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
