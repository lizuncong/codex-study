"use client";

import { useCallback, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { StatCard } from "@/components/monitor/stat-card";
import { formatDuration, formatMemory, formatTime } from "@/lib/monitor/formatters";
import type { LoadTestSummary } from "@/types/load-test";

// 参数收敛在抽屉内，页面头部只需要一个入口，避免占满监控工具栏。
const defaultLoadTestPrompt = "写1000字关于春天的作文";
const maxLoadTestConcurrency = 50;

export function LoadTestDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [concurrencyInput, setConcurrencyInput] = useState("10");
  const [promptInput, setPromptInput] = useState(defaultLoadTestPrompt);
  const [customToolsEnabled, setCustomToolsEnabled] = useState(true);
  const [isLoadTesting, setIsLoadTesting] = useState(false);
  const [loadTestConcurrency, setLoadTestConcurrency] = useState(0);
  const [loadTestProgress, setLoadTestProgress] = useState(0);
  const [loadTestError, setLoadTestError] = useState<string | null>(null);
  const [loadTestSummary, setLoadTestSummary] =
    useState<LoadTestSummary | null>(null);

  const startLoadTest = useCallback(async () => {
    const concurrency = Number(concurrencyInput);
    const prompt = promptInput.trim();

    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > maxLoadTestConcurrency
    ) {
      setLoadTestError(`并发数量必须是 1-${maxLoadTestConcurrency} 的整数。`);
      return;
    }

    if (!prompt) {
      setLoadTestError("请输入压测使用的 prompt。");
      return;
    }

    setIsLoadTesting(true);
    setLoadTestConcurrency(concurrency);
    setLoadTestProgress(0);
    setLoadTestError(null);
    setLoadTestSummary(null);

    try {
      const response = await fetch("/api/load-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concurrency,
          message: prompt,
          customToolsEnabled,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok || !result) {
        throw new Error(result?.error ?? `压测接口返回 ${response.status}`);
      }

      // 压测任务由服务端保存，这里轮询一次任务快照即可同步进度和最终结果。
      const startedTest = result as LoadTestSummary;
      const loadTestId = startedTest.loadTestId;

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const statusResponse = await fetch(
          `/api/load-test?loadTestId=${encodeURIComponent(loadTestId)}`,
          { cache: "no-store" },
        );
        const status = (await statusResponse.json().catch(() => null)) as
          | (LoadTestSummary & { error?: string })
          | null;

        if (!statusResponse.ok || !status) {
          throw new Error(status?.error ?? `压测状态返回 ${statusResponse.status}`);
        }

        setLoadTestSummary(status);
        setLoadTestConcurrency(status.concurrency);
        setLoadTestProgress(status.succeeded + status.failed);

        if (status.status !== "running") {
          return;
        }
      }
    } catch (caughtError) {
      setLoadTestError(
        caughtError instanceof Error ? caughtError.message : "服务端压测失败。",
      );
    } finally {
      setIsLoadTesting(false);
    }
  }, [concurrencyInput, customToolsEnabled, promptInput]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="h-10 rounded-xl border border-black/10 bg-white px-4 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        {isLoadTesting
          ? `压测中 ${loadTestProgress}/${loadTestConcurrency}`
          : "压测设置"}
      </button>

      <Drawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="压测参数"
        description="配置压测 prompt 和并发数量，任务在服务端执行。"
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void startLoadTest();
          }}
        >
          <div>
            <label className="text-sm font-medium" htmlFor="load-test-prompt">
              压测 prompt
            </label>
            <textarea
              className="mt-2 min-h-28 w-full resize-y rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-white/10 dark:bg-zinc-950 dark:focus:border-zinc-600 dark:disabled:bg-zinc-900"
              disabled={isLoadTesting}
              id="load-test-prompt"
              onChange={(event) => setPromptInput(event.target.value)}
              placeholder="输入用于并发压测的 prompt"
              required
              value={promptInput}
            />
          </div>

          <div className="rounded-xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-zinc-950">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-black/20 accent-zinc-950 dark:border-white/20 dark:bg-zinc-900 dark:accent-zinc-100"
                checked={customToolsEnabled}
                disabled={isLoadTesting}
                onChange={(event) => setCustomToolsEnabled(event.target.checked)}
              />
              <span className="text-sm font-medium">
                Codex stdio 自定义工具调用
              </span>
            </label>

            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                可用工具和触发方法
              </summary>
              <div className="mt-3 space-y-3 text-zinc-600 dark:text-zinc-400">
                <p>
                  勾选后，每个压测请求都会注册本地 <code>project_tools</code> MCP
                  server，并启动对应的 stdio 子进程。
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <code>get_project_info</code>：读取项目路径、名称、版本和
                    Node 版本。
                  </li>
                  <li>
                    <code>read_project_file</code>：读取项目根目录内的文本文件。
                  </li>
                </ul>
                <p>在 prompt 中明确要求调用对应工具，更容易触发：</p>
                <ul className="space-y-1 rounded-lg bg-zinc-100 p-3 font-mono text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  <li>请调用 get_project_info 工具，告诉我项目名和项目路径。</li>
                  <li>请调用 read_project_file 工具读取 package.json。</li>
                </ul>
              </div>
            </details>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="load-test-concurrency">
              并发数量
            </label>
            <input
              type="number"
              className="mt-2 h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-white/10 dark:bg-zinc-950 dark:focus:border-zinc-600 dark:disabled:bg-zinc-900"
              disabled={isLoadTesting}
              id="load-test-concurrency"
              max={maxLoadTestConcurrency}
              min={1}
              onChange={(event) => setConcurrencyInput(event.target.value)}
              step={1}
              value={concurrencyInput}
            />
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              允许范围 1-{maxLoadTestConcurrency}，过高会同时消耗较多系统资源。
            </p>
          </div>

          <button
            type="submit"
            className="h-10 w-full rounded-xl bg-zinc-950 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700"
            disabled={isLoadTesting}
          >
            {isLoadTesting ? "压测进行中" : "开始压测"}
          </button>
        </form>

        {loadTestError ? (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {loadTestError}
          </p>
        ) : null}

        {isLoadTesting ? (
          <p className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">
            服务端压测中：{loadTestProgress}/{loadTestConcurrency}
          </p>
        ) : null}

        {loadTestSummary ? (
          <section className="mt-6 border-t border-black/5 pt-5 dark:border-white/10">
            <div>
              <h3 className="text-base font-semibold">压测结果</h3>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="成功"
                value={String(loadTestSummary.succeeded)}
                hint={`失败 ${loadTestSummary.failed}`}
              />
              <StatCard
                label="总耗时"
                value={formatDuration(loadTestSummary.totalMs)}
                hint={`并发 ${loadTestSummary.concurrency}`}
              />
              <StatCard
                label="平均耗时"
                value={
                  loadTestSummary.averageMs === null
                    ? "—"
                    : formatDuration(loadTestSummary.averageMs)
                }
                hint={`最快 ${
                  loadTestSummary.fastestMs === null
                    ? "—"
                    : formatDuration(loadTestSummary.fastestMs)
                }`}
              />
              <StatCard
                label="最慢耗时"
                value={
                  loadTestSummary.slowestMs === null
                    ? "—"
                    : formatDuration(loadTestSummary.slowestMs)
                }
                hint="单次请求"
              />
              <StatCard
                label="内存峰值"
                value={formatMemory(loadTestSummary.peakRssKb)}
                hint="进程树合计 RSS"
              />
              <StatCard
                label="CPU 峰值"
                value={`${loadTestSummary.peakCpuPercent.toFixed(1)}%`}
                hint="进程树合计 CPU"
              />
            </div>

            {loadTestSummary.errors.length > 0 ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                <p className="font-medium">前 3 个错误</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {loadTestSummary.errors.slice(0, 3).map((errorMessage) => (
                    <li key={errorMessage}>{errorMessage}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {loadTestSummary.processes.length > 0 ? (
              <div className="mt-5 overflow-hidden rounded-xl border border-black/5 dark:border-white/10">
                <div className="border-b border-black/5 bg-zinc-50 px-4 py-3 dark:border-white/10 dark:bg-zinc-900">
                  <p className="text-sm font-medium">
                    压测期间出现过的进程（{loadTestSummary.processes.length}）
                  </p>
                </div>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 bg-white text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                      <tr>
                        <th className="px-4 py-2 font-medium">PID / PPID</th>
                        <th className="px-4 py-2 font-medium">类型</th>
                        <th className="px-4 py-2 font-medium">首次出现</th>
                        <th className="px-4 py-2 font-medium">最后出现</th>
                        <th className="px-4 py-2 font-medium">运行时长</th>
                        <th className="px-4 py-2 font-medium">峰值 RSS</th>
                        <th className="px-4 py-2 font-medium">峰值 CPU</th>
                        <th className="px-4 py-2 font-medium">峰值内存</th>
                        <th className="px-4 py-2 font-medium">命令</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadTestSummary.processes.map((process) => (
                        <tr
                          key={`${process.pid}-${process.firstSeenAt}`}
                          className="border-t border-black/5 dark:border-white/10"
                        >
                          <td className="px-4 py-2 font-mono">
                            {process.pid} / {process.parentPid}
                          </td>
                          <td className="px-4 py-2">
                            {process.category === "codex" ? "Codex" : "服务"}
                          </td>
                          <td className="px-4 py-2">
                            {formatTime(process.firstSeenAt)}
                          </td>
                          <td className="px-4 py-2">
                            {formatTime(process.lastSeenAt)}
                          </td>
                          <td className="px-4 py-2 font-mono">
                            {process.latestElapsed}
                          </td>
                          <td className="px-4 py-2">
                            {formatMemory(process.peakRssKb)}
                          </td>
                          <td className="px-4 py-2">
                            {process.maxCpuPercent.toFixed(1)}%
                          </td>
                          <td className="px-4 py-2">
                            {process.maxMemoryPercent.toFixed(1)}%
                          </td>
                          <td className="max-w-sm px-4 py-2">
                            <span className="line-clamp-2 break-all font-mono">
                              {process.command}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </Drawer>
    </>
  );
}
