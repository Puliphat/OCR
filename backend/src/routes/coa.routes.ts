// HTTP layer ของ COA — รับไฟล์ผ่าน multer แล้วโยนเข้า "คิว" (ไม่ได้รันในคำขอแล้ว)
// endpoint หลัก: POST /api/coa/upload (multipart "file" ได้หลายไฟล์) → 202 { jobs }
// + GET /jobs?ids=, GET /jobs/:id, DELETE /jobs/:id, GET /queue, GET /health
// + GET /ocr/daemon-health (probe sidecar) + POST /ocr/restart (spawn sidecar)
import { Router, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { runCoaPipeline, PipelineProgress, OCR_DAEMON_DOWN } from "../services/coa/coa-pipeline";
import { jobQueue, Job } from "../services/queue/job-queue";
import { isOcrDaemonHealthy, restartOcrDaemon, waitForOcrDaemon } from "../services/ocr-daemon";

const router = Router();

// In-memory result cache keyed by file content sha256 — same bytes = same reports.
// Deliberately NOT persisted: backend restart (= code change in dev) clears it,
// so re-testing after a pipeline fix never serves stale results.
type CoaPayload = { reports: unknown[]; logFile: string };
const reportCache = new Map<string, CoaPayload>();

// hash → jobId ของงานที่ "ยังไม่จบ" — คนละคนส่งใบเดียวกันพร้อมกันจะได้ไม่รันซ้ำทั้งใบ
const inFlightByHash = new Map<string, string>();

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
const LOG_DIR = path.join(__dirname, "..", "..", "coa-logs");

// ★ กู้ระบบเมื่อ job พังเพราะ OCR daemon ล่ม ★ — ทำที่นี่ ไม่ใช่ที่ frontend: คิวหยุดรอระหว่างกู้
//   ไม่งั้น job ที่เหลือจะพังไล่กันหมดก่อนใครจะกดปุ่มอะไรทัน
jobQueue.setRecover(async (error) => {
  if (!error.startsWith(OCR_DAEMON_DOWN)) return false;
  console.warn("[coa-route] OCR daemon ล่ม — หยุดคิวแล้วสั่งเริ่ม daemon ใหม่…");
  restartOcrDaemon();
  const ok = await waitForOcrDaemon(60_000);
  console.warn(
    ok
      ? "[coa-route] daemon กลับมาแล้ว — เอางานที่พังกลับเข้าหัวคิว"
      : "[coa-route] daemon ยังไม่ขึ้นใน 60 วิ — ปล่อยงานนี้เป็น error แล้วเดินคิวต่อ"
  );
  return ok;
});

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
  // ★ ปฏิเสธเป็นรายไฟล์ (cb(null,false)) ไม่ใช่โยน error ★ — อัปหลายไฟล์แล้วมีไฟล์เสียหนึ่งอัน
  //   ต้องไม่ทำให้ไฟล์ที่ดีตายไปด้วย (แถมค้างใน uploads/ โดยไม่มีใครลบ)
  fileFilter: (req: Request & { rejectedFiles?: { filename: string; reason: string }[] }, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return cb(null, true);
    (req.rejectedFiles ??= []).push({
      filename: file.originalname,
      reason: `ไม่รองรับไฟล์ ${ext || "(ไม่มีนามสกุล)"}`,
    });
    cb(null, false);
  },
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// ภาพรวมคิวทั้งระบบ (ทุกคนเห็นเหมือนกัน) — { running, waiting, paused }
router.get("/queue", (_req: Request, res: Response) => {
  res.json(jobQueue.snapshot());
});

// Probe Python sidecar — never 500; always 200 with boolean ok
// Response: { ok: boolean }
router.get("/ocr/daemon-health", async (_req: Request, res: Response) => {
  res.json({ ok: await isOcrDaemonHealthy() });
});

// Spawn Python sidecar as detached child; return immediately
// Response: { ok: true } | { ok: false, error: string } (status 500)
router.post("/ocr/restart", (_req: Request, res: Response) => {
  try {
    restartOcrDaemon();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// สถานะงานที่ frontend เอาไปแสดง — รูปเดียวใช้ทั้ง batch และรายตัว
function toStatus(job: Job) {
  const base = { jobId: job.id, filename: job.label, state: job.state };
  switch (job.state) {
    case "queued": {
      const position = jobQueue.position(job.id);
      return {
        ...base,
        position,
        ahead: position == null ? undefined : position - 1,
        etaSec: jobQueue.etaSec(job.id),
      };
    }
    case "running":
      return { ...base, progress: job.progress as PipelineProgress | undefined };
    case "done": {
      // เวลาที่ใช้วิเคราะห์จริง (ไม่รวมเวลารอคิว) — หน้าเว็บเอาไปโชว์ท้ายตาราง
      const durationMs =
        job.startedAt && job.finishedAt ? job.finishedAt - job.startedAt : undefined;
      return { ...base, ...(job.result as CoaPayload), durationMs };
    }
    case "error":
      return { ...base, error: job.error };
    default:
      return base;
  }
}

// poll ทีเดียวหลาย job — อัปหลายไฟล์แล้วไม่ต้องยิงคนละคำขอ
// id ที่หาไม่เจอ (ถูกกวาดทิ้งตาม TTL) ข้ามไปเฉยๆ ไม่ใช่ 404 — frontend เก็บผลเดิมไว้เองอยู่แล้ว
router.get("/jobs", (req: Request, res: Response) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const jobs = ids.map((id) => jobQueue.get(id)).filter((j): j is Job => !!j);
  res.json({ jobs: jobs.map(toStatus) });
});

router.get("/jobs/:id", (req: Request, res: Response) => {
  const job = jobQueue.get(String(req.params.id));
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(toStatus(job));
});

// ยกเลิกได้เฉพาะงานที่ยังไม่เริ่ม (pipeline หยุดกลางคันไม่ได้)
router.delete("/jobs/:id", (req: Request, res: Response) => {
  res.json(jobQueue.cancel(String(req.params.id)));
});

// รับไฟล์ → เข้าคิว → ตอบ jobId ทันที (202). ผลมาทีหลังผ่าน GET /jobs
// อยากเปิด persist DB: uncomment block "TODO: persist ลง DB" ข้างใน runJob
router.post(
  "/upload",
  (req: Request, res: Response, next) => {
    upload.array("file", 20)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  (req: Request & { rejectedFiles?: { filename: string; reason: string }[] }, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const rejected = req.rejectedFiles ?? [];
    if (files.length === 0) {
      return res.status(400).json({ error: "No file uploaded", rejected });
    }

    fs.mkdirSync(LOG_DIR, { recursive: true });

    const jobs = files.map((file) => {
      const filename = path.basename(file.path);
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file.path)).digest("hex");

      // ไฟล์เดิมเคยวิเคราะห์แล้ว → ตอบผลเดิม ไม่ต้องเข้าคิว
      const cached = reportCache.get(hash);
      if (cached) {
        console.log(`[coa-route] cache hit ${hash.slice(0, 12)} — ข้ามคิว`);
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ไฟล์ซ้ำ ไม่ต้องเก็บ */
        }
        return { jobId: jobQueue.addCompleted(file.originalname, cached).id, filename: file.originalname };
      }

      // ไฟล์เดียวกันมีคนสั่งไปแล้วและยังไม่จบ → เกาะงานเดิม (รันรอบเดียวพอ)
      const inFlight = inFlightByHash.get(hash);
      const existing = inFlight ? jobQueue.get(inFlight) : undefined;
      if (existing && (existing.state === "queued" || existing.state === "running")) {
        console.log(`[coa-route] ไฟล์ซ้ำกับงานที่ค้างอยู่ ${hash.slice(0, 12)} — เกาะ job เดิม`);
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ไฟล์ซ้ำ ไม่ต้องเก็บ */
        }
        return { jobId: existing.id, filename: file.originalname };
      }

      const job = jobQueue.enqueue<CoaPayload, PipelineProgress>({
        label: file.originalname,
        cleanup: () => {
          inFlightByHash.delete(hash);
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* ลบไม่ได้ก็ปล่อย — ไฟล์ค้างไม่ใช่ error ที่ผู้ใช้ต้องเห็น */
          }
        },
        run: async (onProgress) => {
          const reports = await runCoaPipeline(file.path, onProgress);

          const logBasename = `${Date.now()}-${filename}.json`;
          // เขียน log ฉบับเต็ม (รวม debug: ocrText/llmRaw) ไว้ diagnose ว่าพังที่ model ไหน
          fs.writeFileSync(path.join(LOG_DIR, logBasename), JSON.stringify(reports, null, 2), "utf8");

          // TODO: persist ลง DB เมื่อเปิดใช้ CoaReportEntity / CoaItemEntity
          // (uncomment imports + entities ใน data-source.ts ก่อน)
          // const repo = AppDataSource.getRepository(CoaReportEntity);
          // await repo.save({ ...reports[0], items: reports[0].rows });

          // ตัด ocrText/llmRaw (ใหญ่) แต่ surface ocrEngine จาก debug — FE ใช้แจ้ง engine
          const reportsForClient = reports.map(({ debug, ...r }) => ({ ...r, ocrEngine: debug?.ocrEngine }));
          const payload: CoaPayload = { reports: reportsForClient, logFile: logBasename };
          reportCache.set(hash, payload);
          inFlightByHash.delete(hash);
          return payload;
        },
      });

      inFlightByHash.set(hash, job.id);
      return { jobId: job.id, filename: file.originalname };
    });

    return res.status(202).json({ jobs, rejected });
  }
);

export default router;
