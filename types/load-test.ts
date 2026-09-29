export type LoadTestStatus = "running" | "completed" | "failed" | "cancelled";

export type LoadTestSummary = {
  loadTestId: string;
  concurrency: number;
  status: LoadTestStatus;
  active: number;
  succeeded: number;
  failed: number;
  fastestMs: number | null;
  slowestMs: number | null;
  averageMs: number | null;
  totalMs: number;
  errors: string[];
};
