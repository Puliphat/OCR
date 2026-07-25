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
  resultRaw: string | null;
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

export interface UploadResponse {
  reports: CoaReport[];
  logFile: string;
}

// ขั้นของ pipeline ที่ backend รายงานระหว่างวิเคราะห์ (poll GET /api/coa/progress/:jobId)
export type PipelineStage = "render" | "ocr" | "parse" | "hq" | "eval";

export interface PipelineProgress {
  stage: PipelineStage;
  page?: number;
  pages?: number;
}
