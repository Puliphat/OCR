// CLI runner — รัน pipeline กับไฟล์ใน uploads/ แบบ batch โดยไม่ผ่าน HTTP
// ใช้เวลา debug normalizer/prompt: ผลพิมพ์ลง stdout + append log ที่ coa-logs/run.log
import * as fs from "fs";
import * as path from "path";
import { formatReport, countRows, CoaReport } from "../services/coa/coa-evaluator";
import { runCoaPipeline } from "../services/coa/coa-pipeline";

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
const LOG_DIR = path.join(__dirname, "..", "..", "coa-logs");

async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const args = process.argv.slice(2);
  const targets =
    args.length > 0
      ? args
      : fs
          .readdirSync(UPLOADS_DIR)
          .filter((f) => /\.(pdf|png|jpg|jpeg)$/i.test(f))
          .map((f) => path.join(UPLOADS_DIR, f));

  const all: CoaReport[] = [];
  for (const f of targets) {
    console.log(`\n>>> processing ${path.basename(f)}`);
    try {
      const reports = await runCoaPipeline(f);

      for (const report of reports) {
        const block = formatReport(report);
        console.log(block);
        fs.appendFileSync(path.join(LOG_DIR, "run.log"), block + "\n");
        all.push(report);
      }

      // Write JSON log — same format as the HTTP route (array)
      const safeFilename = path.basename(f).replace(/\s+/g, "_");
      const logBasename = `${Date.now()}-${safeFilename}.json`;
      fs.writeFileSync(
        path.join(LOG_DIR, logBasename),
        JSON.stringify(reports, null, 2),
        "utf8"
      );
    } catch (e) {
      console.error(`[${path.basename(f)}] FAILED:`, (e as Error).message);
    }
  }

  // นับจากแถวเหมือนที่ formatReport พิมพ์ — r.summary รวมแถว infoOnly ที่ไม่ได้ตรวจไว้ด้วย
  const totals = all.reduce(
    (a, r) => {
      const n = countRows(r.rows);
      a.pass += n.pass;
      a.fail += n.fail;
      a.skip += n.skip;
      a.total += n.total;
      return a;
    },
    { pass: 0, fail: 0, skip: 0, total: 0 }
  );
  const tail = [
    "",
    "=".repeat(110),
    `OVERALL: ${all.length} files, ${totals.pass} PASS, ${totals.fail} FAIL, ${totals.skip} SKIP (of ${totals.total} items)`,
    "=".repeat(110),
  ].join("\n");
  console.log(tail);
  fs.appendFileSync(path.join(LOG_DIR, "run.log"), tail + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
