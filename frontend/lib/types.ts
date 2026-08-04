export type CoaStatus = "PASS" | "FAIL" | "SKIP";

export interface CoaRow {
  name: string;
  unit: string | null;
  method: string | null;
  min: number | null;
  max: number | null;
  result: number | null;
  status: CoaStatus;
  reason: string;
  needsReview?: boolean;
  specRaw: string | null;
  resultRaw: string | null; // ข้อความตามใบ ("200,00 – 250,00") — จอโชว์ผ่าน fmtResult ไม่โชว์ตรง ๆ
  // ค่าผลที่เป็นช่วง (ใบที่มีคอลัมน์ Results Min|Max เช่น RB220) — null เมื่อผลเป็นค่าเดี่ยว
  resultMin?: number | null;
  resultMax?: number | null;
}

export interface CoaReport {
  filename: string;
  product: string | null;
  lotNo: string | null;
  page?: number;
  rows: CoaRow[];
  summary: { pass: number; fail: number; skip: number; total: number };
  ocrEngine?: "text-layer" | "rapidocr";
}

// ขั้นของ pipeline ที่ backend รายงานระหว่างวิเคราะห์
export type PipelineStage = "render" | "ocr" | "parse" | "hq" | "eval";

export interface PipelineProgress {
  stage: PipelineStage;
  page?: number;
  pages?: number;
}

// ── คิวงาน ── งานถูกเข้าคิวที่ backend แล้วรันทีละงาน (poll GET /api/coa/jobs?ids=)
export type JobState = "queued" | "running" | "done" | "error" | "canceled";

export interface JobStatus {
  jobId: string;
  filename: string;
  state: JobState;
  position?: number; // queued: ลำดับในคิว (1 = คิวถัดไป)
  ahead?: number;
  etaSec?: number; // undefined = ยังไม่มีสถิติพอจะประมาณ
  progress?: PipelineProgress; // running
  reports?: CoaReport[]; // done
  logFile?: string; // done
  durationMs?: number; // done: เวลาวิเคราะห์จริง ไม่รวมเวลารอคิว
  error?: string; // error
}

// POST /api/coa/upload → 202
export interface EnqueueResponse {
  jobs: { jobId: string; filename: string }[];
  rejected: { filename: string; reason: string }[];
}

// GET /api/coa/queue — ภาพรวมคิวทั้งระบบ (ทุกคนเห็นเหมือนกัน)
export interface QueueSnapshot {
  running: number;
  waiting: number;
  paused: boolean;
}
