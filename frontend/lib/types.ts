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
}

export interface UploadResponse {
  reports: CoaReport[];
  logFile: string;
}
