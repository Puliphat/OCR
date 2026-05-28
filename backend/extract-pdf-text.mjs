import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

const files = process.argv.slice(2);

for (const file of files) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  console.log(`\n========== ${path.basename(file)} (${pdf.numPages} page(s)) ==========`);
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const text = await page.getTextContent();
    const lines = [];
    let lastY = null;
    let buf = [];
    for (const item of text.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(buf.join(' '));
        buf = [];
      }
      buf.push(item.str);
      lastY = y;
    }
    if (buf.length) lines.push(buf.join(' '));
    console.log(`--- Page ${p} ---`);
    console.log(lines.filter(l => l.trim()).join('\n'));
  }
}
