// dump OCR text ของไฟล์เดียว เพื่อดูชื่อ row → ทำ ground truth
// npx ts-node _validate/dump-ocr.ts <abs-or-rel-path>
import { extractText } from "../src/services/coa/coa-pipeline";
async function main() {
  const f = process.argv[2] || "uploads/20260203_Lot240521.png";
  const { text, engine } = await extractText(f);
  console.log(`=== engine=${engine} len=${text.length} ===`);
  console.log(text);
}
main().catch((e) => { console.error(e); process.exit(1); });
