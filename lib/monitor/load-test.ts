import { randomUUID } from "node:crypto";

import { streamCodexReply } from "@/lib/agent-sdk";
import type { LoadTestStatus, LoadTestSummary } from "@/types/load-test";

type LoadTestState = {
  id: string;
  concurrency: number;
  message: string;
  status: LoadTestStatus;
  active: number;
  succeeded: number;
  failed: number;
  durations: number[];
  errors: string[];
  startedAt: Date;
  endedAt: Date | null;
  abortController: AbortController;
};

const loadTests = new Map<string, LoadTestState>();
let latestLoadTestId: string | null = null;

function summarize(state: LoadTestState): LoadTestSummary {
  const finishedAt = state.endedAt ?? new Date();
  const totalMs = Math.max(0, finishedAt.getTime() - state.startedAt.getTime());
  const fastestMs = state.durations.length
    ? Math.min(...state.durations)
    : null;
  const slowestMs = state.durations.length
    ? Math.max(...state.durations)
    : null;
  const averageMs = state.durations.length
    ? Math.round(
        state.durations.reduce((total, duration) => total + duration, 0) /
          state.durations.length,
      )
    : null;

  return {
    loadTestId: state.id,
    concurrency: state.concurrency,
    status: state.status,
    active: state.active,
    succeeded: state.succeeded,
    failed: state.failed,
    fastestMs,
    slowestMs,
    averageMs,
    totalMs,
    errors: [...state.errors],
  };
}

function getLoadTestState(loadTestId?: string | null): LoadTestState | null {
  if (loadTestId) {
    return loadTests.get(loadTestId) ?? null;
  }

  return latestLoadTestId ? loadTests.get(latestLoadTestId) ?? null : null;
}

export function startLoadTest(input: {
  concurrency: number;
  message: string;
}): LoadTestSummary {
  const currentTest = getLoadTestState();

  if (currentTest?.status === "running") {
    throw new Error("已有压测正在运行。");
  }

  const state: LoadTestState = {
    id: randomUUID(),
    concurrency: input.concurrency,
    message: input.message,
    status: "running",
    active: 0,
    succeeded: 0,
    failed: 0,
    durations: [],
    errors: [],
    startedAt: new Date(),
    endedAt: null,
    abortController: new AbortController(),
  };

  loadTests.set(state.id, state);
  latestLoadTestId = state.id;

  return summarize(state);
}

export async function runLoadTest(loadTestId: string): Promise<void> {
  const state = loadTests.get(loadTestId);

  if (!state || state.status !== "running") {
    return;
  }

  const tasks = Array.from({ length: state.concurrency }, async () => {
    const startedAt = performance.now();
    state.active += 1;

    try {
      await streamCodexReply({
        message: state.message,
        signal: state.abortController.signal,
        onEvent: () => {},
      });
      state.succeeded += 1;
    } catch (caughtError) {
      state.failed += 1;

      if (state.errors.length < 10) {
        state.errors.push(
          caughtError instanceof Error
            ? caughtError.message
            : "Codex 回复失败。",
        );
      }
    } finally {
      state.active -= 1;
      state.durations.push(performance.now() - startedAt);
    }
  });

  await Promise.all(tasks);

  state.endedAt = new Date();

  if (state.abortController.signal.aborted) {
    state.status = "cancelled";
  } else if (state.failed > 0) {
    state.status = "failed";
  } else {
    state.status = "completed";
  }
}

export function getLoadTestSummary(
  loadTestId?: string | null,
): LoadTestSummary | null {
  const state = getLoadTestState(loadTestId);

  return state ? summarize(state) : null;
}

export function cancelLoadTest(
  loadTestId?: string | null,
): LoadTestSummary | null {
  const state = getLoadTestState(loadTestId);

  if (!state) {
    return null;
  }

  state.abortController.abort();

  return summarize(state);
}
