// แผง progress ระหว่างวิเคราะห์ — โชว์ขั้นจริงจาก backend (poll /api/coa/progress/:jobId)
// + นาฬิกาวิ่ง + หลอดเปอร์เซ็นต์ (ห้ามถอยหลัง). mount ใหม่ทุกครั้งที่เริ่มวิเคราะห์ → state สะอาดเอง
import { useState } from "react";
import { PipelineProgress } from "@/lib/types";

const STEPS = [
  { key: "render", label: "เตรียมไฟล์" },
  { key: "ocr", label: "อ่านตัวอักษร (OCR)" },
  { key: "parse", label: "AI อ่านตาราง" },
  { key: "eval", label: "เทียบเกณฑ์ Spec" },
] as const;

// stage จาก backend → ขั้นใน STEPS (hq = ยังอยู่ขั้น AI แต่ตรวจซ้ำละเอียดสูง)
const STAGE_IDX: Record<PipelineProgress["stage"], number> = {
  render: 0,
  ocr: 1,
  parse: 2,
  hq: 2,
  eval: 3,
};

// % คร่าวๆ ตามน้ำหนักเวลาจริงที่วัดไว้ (OCR ~ครึ่งแรก, AI อ่านตาราง = ก้อนใหญ่สุด)
function pct(p: PipelineProgress | null): number {
  if (!p) return 4;
  const frac = p.page && p.pages ? (p.page - 0.5) / p.pages : 0.5;
  switch (p.stage) {
    case "render":
      return 8;
    case "ocr":
      return 10 + frac * 25;
    case "parse":
      return 38 + frac * 47;
    case "hq":
      return 87;
    case "eval":
      return 96;
  }
}

export default function ProgressPanel({
  progress,
  liveMs,
}: {
  progress: PipelineProgress | null;
  liveMs: number;
}) {
  // หลอดห้ามถอยหลัง (ขั้นข้ามหน้า/HQ ทำ % ดิบแกว่งได้) — derived-state ระหว่าง render
  const [target, setTarget] = useState(4);
  const raw = pct(progress);
  if (raw > target) setTarget(raw);

  const activeIdx = progress ? STAGE_IDX[progress.stage] : 0;
  const pageInfo =
    progress?.page && progress?.pages && progress.pages > 1
      ? `หน้า ${progress.page}/${progress.pages}`
      : null;

  return (
    <div className="progress-panel">
      <div className="progress-body">
        <div className="scanner">
          <div className="scanner-doc"></div>
          <div className="scanner-line"></div>
        </div>

        <ol className="p-steps">
          {STEPS.map((s, i) => {
            const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
            return (
              <li key={s.key} className={`p-step ${state}`}>
                <span className="p-dot">
                  {state === "done" ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5.5L4 8L8.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
                <span className="p-label">{s.label}</span>
                {state === "active" && pageInfo && <span className="p-page mono">{pageInfo}</span>}
                {state === "active" && progress?.stage === "hq" && (
                  <span className="p-hq">ตรวจซ้ำละเอียดสูง</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="p-bar">
        <div className="p-bar-fill" style={{ width: `${target}%` }} />
      </div>

      <div className="p-meta mono">
        <span className="p-clock">{(liveMs / 1000).toFixed(1)}s</span>
        <span className="p-hint">ปกติ ~20 วิ · ไฟล์ scan หลายหน้า ~45 วิ</span>
      </div>
    </div>
  );
}
