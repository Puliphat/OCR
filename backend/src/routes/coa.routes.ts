// HTTP layer ของ COA — รับไฟล์ผ่าน multer แล้วโยนเข้า pipeline
// endpoint หลัก: POST /api/coa/upload (multipart "file") + GET /api/coa/health
// + GET /ocr/daemon-health (probe sidecar) + POST /ocr/restart (spawn sidecar)
import { Router, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import * as crypto from "crypto";
import axios from "axios";
import { runCoaPipeline, PipelineProgress } from "../services/coa/coa-pipeline";

const router = Router();

// In-memory result cache keyed by file content sha256 — same bytes = same reports.
// Deliberately NOT persisted: backend restart (= code change in dev) clears it,
// so re-testing after a pipeline fix never serves stale results.
const reportCache = new Map<string, unknown>();

// Progress ต่อ jobId — FE ส่ง jobId มากับ form แล้ว poll GET /progress/:jobId ระหว่างรอผล
// เก็บใน memory เฉยๆ + กวาดตัวเก่าทิ้ง (client ที่ปิดหน้ากลางทางจะไม่ค้าง)
const progressMap = new Map<string, PipelineProgress & { updatedAt: number }>();
const PROGRESS_TTL_MS = 10 * 60_000;
function sweepProgress() {
  const now = Date.now();
  for (const [k, v] of progressMap) {
    if (now - v.updatedAt > PROGRESS_TTL_MS) progressMap.delete(k);
  }
}

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

// ขั้นที่ pipeline กำลังทำของ job นี้ — null = ยังไม่เริ่ม/จบไปแล้ว
// Response: { progress: { stage, page?, pages? } | null }
router.get("/progress/:jobId", (req: Request, res: Response) => {
  const p = progressMap.get(String(req.params.jobId));
  res.json({ progress: p ? { stage: p.stage, page: p.page, pages: p.pages } : null });
});

// Probe Python sidecar — never 500; always 200 with boolean ok
// Response: { ok: boolean }
router.get("/ocr/daemon-health", async (_req: Request, res: Response) => {
  const sidecarUrl =
    process.env.OCR_SIDECAR_URL || "http://127.0.0.1:8765";
  try {
    await axios.get(`${sidecarUrl}/health`, { timeout: 2000 });
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false });
  }
});

// Spawn Python sidecar as detached child; return immediately
// Paths resolved relative to repo root (3 levels up from backend/src/routes)
// Response: { ok: true } | { ok: false, error: string } (status 500)
router.post("/ocr/restart", (_req: Request, res: Response) => {
  try {
    const repoRoot = path.join(__dirname, "..", "..", "..");
    const pythonExe = path.join(
      repoRoot,
      "ocr-py",
      "venv",
      "Scripts",
      "python.exe"
    );
    const serverScript = path.join(repoRoot, "ocr-py", "ocr_server.py");

    const child = child_process.spawn(pythonExe, [serverScript, "8765"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// รับไฟล์ → save → runCoaPipeline → เขียน JSON log → return reports
// อยากเปิด persist DB: uncomment block "TODO: persist ลง DB" ข้างใน
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

    // jobId จาก FE (มากับ form) — ใช้ผูก progress; รูปแบบไม่ผ่าน = ไม่รายงาน progress เฉยๆ
    const jobId =
      typeof req.body?.jobId === "string" && /^[\w-]{8,64}$/.test(req.body.jobId)
        ? req.body.jobId
        : null;

    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      sweepProgress();

      const hash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(req.file.path))
        .digest("hex");
      const cached = reportCache.get(hash);
      if (cached) {
        console.log(`[coa-route] cache hit ${hash.slice(0, 12)} — skip pipeline`);
        return res.json(cached);
      }

      const onProgress = jobId
        ? (p: PipelineProgress) => progressMap.set(jobId, { ...p, updatedAt: Date.now() })
        : undefined;
      const reports = await runCoaPipeline(req.file.path, onProgress);

      const safeFilename = path.basename(req.file.path);
      const logBasename = `${Date.now()}-${safeFilename}.json`;
      const logPath = path.join(LOG_DIR, logBasename);
      // เขียน log ฉบับเต็ม (รวม debug: ocrText/llmRaw) ไว้ diagnose ว่าพังที่ model ไหน
      fs.writeFileSync(logPath, JSON.stringify(reports, null, 2), "utf8");

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

      // HTTP response: ตัด ocrText/llmRaw (ใหญ่) แต่ surface ocrEngine จาก debug — FE ใช้แจ้ง engine
      const reportsForClient = reports.map(({ debug, ...r }) => ({ ...r, ocrEngine: debug?.ocrEngine }));
      const payload = { reports: reportsForClient, logFile: logBasename };
      reportCache.set(hash, payload);
      return res.json(payload);
    } catch (e) {
      console.error("[coa-route] pipeline error:", (e as Error).message);
      return res.status(500).json({ error: (e as Error).message });
    } finally {
      if (jobId) progressMap.delete(jobId); // จบแล้ว (สำเร็จ/พัง) — FE เลิก poll เอง
    }
  }
);

export default router;
