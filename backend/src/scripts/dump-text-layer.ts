import { extractPdfText } from "../services/coa/pdf-text-extractor";
(async () => {
  const file = process.argv[2];
  const res = await extractPdfText(file);
  console.log(`=== chars: ${res.text.replace(/\s/g, "").length} | pages: ${res.pageCount} ===`);
  console.log(res.text);
})();
