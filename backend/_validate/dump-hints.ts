// dump direction hints จาก header geometry — ตรวจว่า classifier อ่านทิศถูกก่อนรัน full pipeline
// npx ts-node _validate/dump-hints.ts "<pdf path>"
import { extractHeaderDirectionHints } from "../src/services/coa/header-direction";
async function main() {
  const f = process.argv[2] || "C:\\Users\\HP Omen\\Desktop\\uploads\\20260422_Barimite200_Lot_26031301.pdf";
  const hints = await extractHeaderDirectionHints(f);
  console.log(`hints (${hints.length}):`);
  for (const h of hints) console.log(`  ${h.name.padEnd(28)} value=${h.value}  -> ${h.direction === "min" ? ">= (Min)" : "<= (Max)"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
