export type CodexRequestStatus = "completed" | "failed";

export type CodexRequestRecord = {
  status: CodexRequestStatus;
  durationMs: number;
  endedAt: string;
  error?: string;
};

type CodexRequestMetricsState = {
  active: number;
  completed: number;
  failed: number;
  totalDurationMs: number;
  last: CodexRequestRecord | null;
};

export type CodexRequestMetricsSnapshot = {
  active: number;
  completed: number;
  failed: number;
  averageDurationMs: number | null;
  last: CodexRequestRecord | null;
};

const state: CodexRequestMetricsState = {
  active: 0,
  completed: 0,
  failed: 0,
  totalDurationMs: 0,
  last: null,
};

export type CodexRequestTracker = {
  succeed: () => void;
  fail: (error: unknown) => void;
};

export function beginCodexRequest(): CodexRequestTracker {
  const startedAt = performance.now();
  state.active += 1;

  let isFinished = false;

  const finish = (status: CodexRequestStatus, error?: unknown) => {
    if (isFinished) {
      return;
    }

    isFinished = true;
    state.active = Math.max(0, state.active - 1);
    state.totalDurationMs += performance.now() - startedAt;

    if (status === "completed") {
      state.completed += 1;
    } else {
      state.failed += 1;
    }

    state.last = {
      status,
      durationMs: Math.round(performance.now() - startedAt),
      endedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : undefined,
    };
  };

  return {
    succeed: () => finish("completed"),
    fail: (error) => finish("failed", error),
  };
}

export function getCodexRequestMetricsSnapshot(): CodexRequestMetricsSnapshot {
  const finishedRequests = state.completed + state.failed;

  return {
    active: state.active,
    completed: state.completed,
    failed: state.failed,
    averageDurationMs:
      finishedRequests === 0
        ? null
        : Math.round(state.totalDurationMs / finishedRequests),
    last: state.last,
  };
}
