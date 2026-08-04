// งาน 1 ชิ้นในคิว — สลับเนื้อตามสถานะ (รอคิว / กำลังทำ / เสร็จ / พัง / ยกเลิก)
// ★ ไม่ห่อการ์ดซ้อนการ์ด ★ ResultsCard กับแผง progress เป็น .card อยู่แล้ว ที่นี่เติมแค่หัวเรื่องบางๆ
// หัวเรื่องโผล่เฉพาะตอนมีหลายงานพร้อมกัน — อัปไฟล์เดียวหน้าตาเหมือนเดิมทุกอย่าง
import { JobStatus } from "@/lib/types";
import ProgressPanel from "./ProgressPanel";
import ResultsCard from "./ResultsCard";
import HelperBar from "./HelperBar";

const STATE_LABEL: Record<JobStatus["state"], string> = {
  queued: "รอคิว",
  running: "กำลังวิเคราะห์",
  done: "เสร็จแล้ว",
  error: "ไม่สำเร็จ",
  canceled: "ยกเลิกแล้ว",
};

export default function JobCard({
  job,
  liveMs,
  elapsedMs,
  showHead,
  onCancel,
}: {
  job: JobStatus;
  liveMs: number;
  elapsedMs: number | null;
  showHead: boolean;
  onCancel: (jobId: string) => void;
}) {
  const reports = job.reports ?? [];

  return (
    <div className="job">
      {showHead && (
        <div className="job-head">
          <span className="job-name" title={job.filename}>
            {job.filename}
          </span>
          <span className={`job-state ${job.state}`}>{STATE_LABEL[job.state]}</span>
        </div>
      )}

      {(job.state === "queued" || job.state === "running") && (
        <div className="card">
          <ProgressPanel
            progress={job.progress ?? null}
            liveMs={liveMs}
            queue={
              job.state === "queued" && job.position != null
                ? { position: job.position, etaSec: job.etaSec }
                : null
            }
          />
        </div>
      )}

      {job.state === "queued" && (
        <button className="job-cancel" onClick={() => onCancel(job.jobId)}>
          ยกเลิกงานนี้
        </button>
      )}

      {job.state === "done" && (
        <>
          {reports.length > 1 && <div className="job-note mono">พบ {reports.length} lot/หน้า</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: reports.length > 1 ? 12 : 0 }}>
            {reports.map((rep, i) => (
              <ResultsCard
                key={i}
                report={rep}
                logFile={job.logFile ?? ""}
                elapsedMs={i === 0 ? elapsedMs : null}
                index={i}
                total={reports.length}
              />
            ))}
          </div>
        </>
      )}

      {job.state === "error" && (
        <HelperBar variant="error">
          {job.error?.startsWith("OCR_DAEMON_DOWN") ? (
            <>
              <strong style={{ color: "var(--ink)" }}>OCR daemon ไม่ทำงาน</strong> — ระบบสั่งเริ่มให้เองแล้วแต่ยังไม่ขึ้น
              · เริ่มเองได้ที่ backend: <code>npm run ocr:daemon</code> แล้วอัปไฟล์ใหม่
            </>
          ) : job.error?.startsWith("PDF_GRID_DOWN") ? (
            /* pdfplumber ล้ม = ตัวอ่านคอลัมน์หาย → ผลจะตกเงียบถ้าปล่อยผ่าน จึงหยุดไว้ก่อน
               (ต่างจาก daemon ตรงที่กู้เองไม่ได้ — ต้องไปซ่อม venv ที่ ocr-py) */
            <>
              <strong style={{ color: "var(--ink)" }}>ตัวอ่านตารางไม่ทำงาน</strong> — ระบบหยุดไว้ก่อนเพราะถ้าอ่านต่อ
              ผลจะตกโดยไม่มีสัญญาณ · ตรวจ Python venv ที่ <code>ocr-py</code> แล้วลองใหม่
              <br />
              <span style={{ opacity: 0.75, fontSize: "0.9em" }}>{job.error}</span>
            </>
          ) : (
            job.error ?? "Something went wrong while analyzing."
          )}
        </HelperBar>
      )}

      {job.state === "canceled" && <div className="job-note">ยกเลิกแล้ว</div>}
    </div>
  );
}
