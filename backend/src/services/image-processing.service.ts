import sharp = require("sharp");
import * as path from "path";

export class ImageProcessingService {
  async processImage(filePath: string): Promise<string> {
    try {
      console.log(`Processing image: ${filePath}`);

      const processedFilePath = path.join(
        path.dirname(filePath),
        `processed_${path.basename(filePath)}`
      );

      await sharp(filePath)
        .grayscale() // Remove color noise
        .resize({ width: 2000, withoutEnlargement: false }) // Upscale to improve text resolution (target width 2000px)
        .sharpen() // Enhance edges
        .toFile(processedFilePath);

      console.log(`Image processed and saved to: ${processedFilePath}`);
      return processedFilePath;
    } catch (error) {
      console.error("Failed to process image", error);
      // Fallback to original file if processing fails
      return filePath;
    }
  }
}
