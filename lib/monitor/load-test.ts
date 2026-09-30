import { randomUUID } from "node:crypto";

import { streamCodexReply } from "@/lib/agent-sdk";
import { getMonitorSnapshot } from "@/lib/monitor/process-metrics";
import type { LoadTestStatus, LoadTestSummary } from "@/types/load-test";
import type { LoadTestProcess, LoadTestProcessCategory } from "@/types/load-test";
import type { MonitorSnapshot } from "@/types/monitor";

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
  processes: Map<number, LoadTestProcess>;
  peakRssKb: number;
  peakCpuPercent: number;
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
    peakRssKb: state.peakRssKb,
    peakCpuPercent: state.peakCpuPercent,
    processes: [...state.processes.values()].sort((left, right) =>
      left.firstSeenAt.localeCompare(right.firstSeenAt) || left.pid - right.pid,
    ),
  };
}

function recordProcessSamples(
  state: LoadTestState,
  snapshot: MonitorSnapshot,
): void {
  const processGroups: Array<{
    category: LoadTestProcessCategory;
    samples: MonitorSnapshot["codex"]["processes"];
  }> = [
    { category: "codex", samples: snapshot.codex.processes },
    { category: "service", samples: snapshot.service.processes },
  ];

  for (const { category, samples } of processGroups) {
    for (const sample of samples) {
      const existing = state.processes.get(sample.pid);

      if (existing) {
        existing.lastSeenAt = snapshot.sampledAt;
        existing.sampleCount += 1;
        existing.latestElapsed = sample.elapsed;
        existing.peakRssKb = Math.max(existing.peakRssKb, sample.rssKb);
        existing.maxCpuPercent = Math.max(
          existing.maxCpuPercent,
          sample.cpuPercent,
        );
        existing.maxMemoryPercent = Math.max(
          existing.maxMemoryPercent,
          sample.memoryPercent,
        );
        continue;
      }

      state.processes.set(sample.pid, {
        pid: sample.pid,
        parentPid: sample.parentPid,
        category,
        command: sample.command,
        firstSeenAt: snapshot.sampledAt,
        lastSeenAt: snapshot.sampledAt,
        sampleCount: 1,
        latestElapsed: sample.elapsed,
        peakRssKb: sample.rssKb,
        maxCpuPercent: sample.cpuPercent,
        maxMemoryPercent: sample.memoryPercent,
      });
    }
  }

  state.peakRssKb = Math.max(
    state.peakRssKb,
    snapshot.service.totalRssKb,
  );
  state.peakCpuPercent = Math.max(
    state.peakCpuPercent,
    snapshot.service.processes.reduce(
      (total, process) => total + process.cpuPercent,
      0,
    ),
  );
}

async function sampleProcessesWhile(
  state: LoadTestState,
  shouldSample: () => boolean,
): Promise<void> {
  while (shouldSample()) {
    try {
      const snapshot = await getMonitorSnapshot();
      recordProcessSamples(state, snapshot);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
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
    processes: new Map(),
    peakRssKb: 0,
    peakCpuPercent: 0,
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

  let sampling = true;
  const samplingTask = sampleProcessesWhile(state, () => sampling);

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
  sampling = false;
  await samplingTask;

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
