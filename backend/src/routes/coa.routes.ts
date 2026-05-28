import { Router, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import { runCoaPipeline } from "../services/coa/coa-pipeline";

const router = Router();

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
const LOG_DIR = path.join(__dirname, "..", "..", "coa-logs");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const ALLOWED_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

router.post(
  "/upload",
  (req: Request, res: Response, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });

      const report = await runCoaPipeline(req.file.path);

      const safeFilename = path.basename(req.file.path);
      const logBasename = `${Date.now()}-${safeFilename}.json`;
      const logPath = path.join(LOG_DIR, logBasename);
      fs.writeFileSync(logPath, JSON.stringify(report, null, 2), "utf8");

      // TODO: persist ลง DB เมื่อเปิดใช้ CoaReportEntity / CoaItemEntity
      // (uncomment imports + entities ใน data-source.ts ก่อน)
      // const repo = AppDataSource.getRepository(CoaReportEntity);
      // const saved = await repo.save({
      //   filename: report.filename,
      //   product: report.product,
      //   lotNo: report.lotNo,
      //   passCount: report.summary.pass,
      //   failCount: report.summary.fail,
      //   skipCount: report.summary.skip,
      //   totalCount: report.summary.total,
      //   items: report.rows.map((r) => ({
      //     name: r.name,
      //     unit: r.unit,
      //     method: r.method,
      //     min: r.min,
      //     max: r.max,
      //     result: r.result,
      //     status: r.status,
      //     reason: r.reason,
      //     specRaw: r.specRaw,
      //     resultRaw: r.resultRaw,
      //   })),
      // });
      // return res.json({ report, logFile: logBasename, id: saved.id });

      return res.json({ report, logFile: logBasename });
    } catch (e) {
      console.error("[coa-route] pipeline error:", (e as Error).message);
      return res.status(500).json({ error: (e as Error).message });
    }
  }
);

export default router;
