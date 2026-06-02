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
  specRaw: string | null;
  resultRaw: string | null;
}

export interface CoaReport {
  filename: string;
  product: string | null;
  lotNo: string | null;
  rows: CoaRow[];
  summary: { pass: number; fail: number; skip: number; total: number };
}

export interface UploadResponse {
  report: CoaReport;
  logFile: string;
}
