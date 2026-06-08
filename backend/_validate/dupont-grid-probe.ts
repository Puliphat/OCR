// one-off: dump spatial grid (reconstructTextGrid) for 1F1710 pages — see if "Specification" header
//   + the right Min/Max pair are legible enough for a deterministic spec-recovery.
// run: npx ts-node _validate/dupont-grid-probe.ts
import { RapidOcrService } from "../src/services/coa/rapidocr.service";

const UPLOADS = "C:\\Users\\HP Omen\\Desktop\\uploads";
const PAGES = [
  "20260514_1F1710_Lot_26011A.p2.png",
  "20260514_1F1710_Lot_26011A.p3.png",
  "20260514_1F1710_Lot_26011A.p4.png",
];

async function main() {
  const svc = new RapidOcrService();
  for (const f of PAGES) {
    const toks = await svc.getProcessedTokens(`${UPLOADS}\\${f}`);
    console.log("\n" + "=".repeat(110) + `\n### ${f}  (tokens=${toks?.length ?? 0})`);
    if (!toks) {
      console.log("  (no tokens — daemon down?)");
      continue;
    }
    console.log("--- FLAT reconstructText ---");
    console.log(svc.reconstructText(toks));
    console.log("\n--- GRID reconstructTextGrid (colGapMul=1.5) ---");
    console.log(svc.reconstructTextGrid(toks, { colGapMul: 1.5 }));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
