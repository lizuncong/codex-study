export type LoadTestStatus = "running" | "completed" | "failed" | "cancelled";

export type LoadTestProcessCategory = "codex" | "service";

export type LoadTestProcess = {
  pid: number;
  parentPid: number;
  category: LoadTestProcessCategory;
  command: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sampleCount: number;
  latestElapsed: string;
  peakRssKb: number;
  maxCpuPercent: number;
  maxMemoryPercent: number;
};

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
  peakRssKb: number;
  peakCpuPercent: number;
  processes: LoadTestProcess[];
};
