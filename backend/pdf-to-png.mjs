import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

const files = process.argv.slice(2);
const outDir = 'png-out';
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  const base = path.basename(file, '.pdf');
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const targetWidth = 1400;
    const viewport0 = page.getViewport({ scale: 1 });
    const scale = targetWidth / viewport0.width;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const buf = canvas.toBuffer('image/png');
    const out = path.join(outDir, `${base}_p${p}.png`);
    fs.writeFileSync(out, buf);
    console.log(out);
  }
}
