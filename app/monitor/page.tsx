"use client";

import { useCallback, useEffect, useState } from "react";
import type { MonitorSnapshot } from "@/types/monitor";
import {
  formatDuration,
  formatMemory,
  formatNumber,
  formatTime,
} from "@/lib/monitor/formatters";
import { StatCard } from "@/components/monitor/stat-card";
import { LoadTestDrawer } from "@/components/monitor/load-test-drawer";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

export default function MonitorPage() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(1000);

  const loadSnapshot = useCallback(
    async (signal: AbortSignal, silent = false) => {
      if (!silent) {
        setIsLoading(true);
      }

      try {
        const response = await fetch("/api/monitor", {
          cache: "no-store",
          signal,
        });

        if (!response.ok) {
          throw new Error(`监控接口返回 ${response.status}`);
        }

        const nextSnapshot = (await response.json()) as MonitorSnapshot;
        setSnapshot(nextSnapshot);
        setError(null);
      } catch (caughtError) {
        if (caughtError instanceof DOMException && caughtError.name === "AbortError") {
          return;
        }

        setError(
          caughtError instanceof Error ? caughtError.message : "读取监控数据失败。",
        );
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (isPaused) {
      return;
    }

    const abortController = new AbortController();
    const initialLoadTimer = setTimeout(() => {
      loadSnapshot(abortController.signal);
    }, 0);
    const timer = setInterval(() => {
      loadSnapshot(abortController.signal, true);
    }, refreshIntervalMs);

    return () => {
      clearTimeout(initialLoadTimer);
      clearInterval(timer);
      abortController.abort();
    };
  }, [isPaused, loadSnapshot, refreshIntervalMs]);

  const refreshNow = useCallback(() => {
    const abortController = new AbortController();
    loadSnapshot(abortController.signal);
  }, [loadSnapshot]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Codex 监控</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              查看 Codex 子进程资源占用和服务端请求指标。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LoadTestDrawer />
            <select
              value={refreshIntervalMs}
              onChange={(event) => setRefreshIntervalMs(Number(event.target.value))}
              className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none dark:border-white/10 dark:bg-zinc-950"
            >
              <option value={1000}>每 1 秒</option>
              <option value={2000}>每 2 秒</option>
              <option value={5000}>每 5 秒</option>
            </select>
            <button
              type="button"
              onClick={() => setIsPaused((current) => !current)}
              className="h-10 rounded-xl border border-black/10 bg-white px-4 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              {isPaused ? "恢复刷新" : "暂停刷新"}
            </button>
            <button
              type="button"
              onClick={refreshNow}
              disabled={isLoading}
              className="h-10 rounded-xl bg-zinc-950 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700"
            >
              立即刷新
            </button>
          </div>
        </header>

        <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span
            className={`size-1.5 rounded-full ${
              isPaused
                ? "bg-amber-500"
                : isLoading
                  ? "animate-pulse bg-blue-500"
                  : "bg-emerald-500"
            }`}
          />
          <span>
            {isPaused
              ? "自动刷新已暂停"
              : snapshot
                ? `上次更新 ${formatTime(snapshot.sampledAt)}`
                : "正在连接监控接口…"}
          </span>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {isLoading && !snapshot ? (
          <div className="mt-8 rounded-2xl border border-black/5 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-400">
            正在加载监控数据…
          </div>
        ) : null}

        {snapshot ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Next.js 进程"
                value={String(snapshot.service.count)}
                hint={`根 PID ${snapshot.server?.pid ?? "—"}`}
              />
              <StatCard
                label="服务合计内存"
                value={formatMemory(snapshot.service.totalRssKb)}
                hint={`单进程峰值 ${formatMemory(snapshot.service.maxRssKb)}`}
              />
              <StatCard
                label="Codex 相关进程"
                value={String(snapshot.codex.count)}
                hint={`合计内存 ${formatMemory(snapshot.codex.totalRssKb)}`}
              />
              <StatCard
                label="Codex 合计内存"
                value={formatMemory(snapshot.codex.totalRssKb)}
                hint={`单进程峰值 ${formatMemory(snapshot.codex.maxRssKb)}`}
              />
              <StatCard
                label="活跃请求"
                value={String(snapshot.requests.active)}
                hint={`已完成 ${snapshot.requests.completed}`}
              />
              <StatCard
                label="平均耗时"
                value={
                  snapshot.requests.averageDurationMs === null
                    ? "—"
                    : formatDuration(snapshot.requests.averageDurationMs)
                }
                hint={`失败 ${snapshot.requests.failed}`}
              />
            </section>

            <section className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-950">
                <h2 className="text-lg font-semibold">Next.js 根进程</h2>
                {snapshot.server ? (
                  <div className="mt-3 divide-y divide-black/5 dark:divide-white/5">
                    <DetailRow label="PID" value={String(snapshot.server.pid)} />
                    <DetailRow label="运行时长" value={snapshot.server.elapsed} />
                    <DetailRow label="RSS" value={formatMemory(snapshot.server.rssKb)} />
                    <DetailRow label="CPU" value={`${formatNumber(snapshot.server.cpuPercent)}%`} />
                    <DetailRow
                      label="系统内存"
                      value={`${formatNumber(snapshot.server.memoryPercent)}%`}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                    暂无服务进程数据。
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-950">
                <h2 className="text-lg font-semibold">最近请求</h2>
                {snapshot.requests.last ? (
                  <div className="mt-3 divide-y divide-black/5 dark:divide-white/5">
                    <DetailRow
                      label="状态"
                      value={
                        snapshot.requests.last.status === "completed"
                          ? "成功"
                          : "失败"
                      }
                    />
                    <DetailRow
                      label="耗时"
                      value={formatDuration(snapshot.requests.last.durationMs)}
                    />
                    <DetailRow
                      label="结束时间"
                      value={formatTime(snapshot.requests.last.endedAt)}
                    />
                    <DetailRow
                      label="错误"
                      value={snapshot.requests.last.error ?? "无"}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                    服务重启后还没有请求记录。
                  </p>
                )}
                {snapshot.warning ? (
                  <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                    {snapshot.warning}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-950">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">服务进程树</h2>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  服务树最高瞬时 CPU {formatNumber(snapshot.service.maxCpuPercent)}%
                </span>
              </div>

              {snapshot.service.processes.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                  当前没有服务进程。
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                        <th className="pb-3 pr-4 font-medium">树形</th>
                        <th className="pb-3 pr-4 font-medium">PID</th>
                        <th className="pb-3 pr-4 font-medium">PPID</th>
                        <th className="pb-3 pr-4 font-medium">运行时长</th>
                        <th className="pb-3 pr-4 font-medium">RSS</th>
                        <th className="pb-3 pr-4 font-medium">CPU</th>
                        <th className="pb-3 pr-4 font-medium">系统内存</th>
                        <th className="pb-3 font-medium">命令</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                      {snapshot.service.processes.map((process) => (
                        <tr key={process.pid}>
                          <td
                            className="py-3 pr-4 font-mono text-xs text-zinc-400 dark:text-zinc-600"
                            style={{ paddingLeft: `${process.depth * 18}px` }}
                          >
                            {process.depth === 0 ? "○" : "└"}
                          </td>
                          <td className="py-3 pr-4 font-mono">{process.pid}</td>
                          <td className="py-3 pr-4 font-mono">{process.parentPid}</td>
                          <td className="py-3 pr-4 font-mono">{process.elapsed}</td>
                          <td className="py-3 pr-4 font-mono">
                            {formatMemory(process.rssKb)}
                          </td>
                          <td className="py-3 pr-4 font-mono">
                            {formatNumber(process.cpuPercent)}%
                          </td>
                          <td className="py-3 pr-4 font-mono">
                            {formatNumber(process.memoryPercent)}%
                          </td>
                          <td className="max-w-[420px] py-3">
                            <div
                              className="truncate font-mono text-xs"
                              title={process.command}
                            >
                              {process.command}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
