import { beginCodexRequest } from "@/lib/monitor/request-metrics";
import { buildCustomToolsConfig } from "@/lib/agent-sdk/custom-tools";
import { buildMultiAgentInstructions } from "@/lib/agent-sdk/game-orchestrator";
import { buildModelInstructionsPath } from "@/lib/agent-sdk/system-prompt";
import type { CodexStreamOptions } from "@/types/codex";
import { AppServerConnection } from "@/lib/codex-app-server/connection";

/**
 * app-server 的事件 item 类型用 camelCase（agentMessage / mcpToolCall），
 * 和 SDK exec 模式的 snake_case（agent_message / mcp_tool_call）不同。
 * 这里做一层映射，让上层 ChatStreamEvent 格式保持一致。
 */
type AppServerThreadItem = {
  id: string;
  type: string;
  text?: string;
  server?: string;
  tool?: string;
  status?: string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { message?: string };
  receiverThreadIds?: string[];
  agentsStates?: Record<string, { status?: string }>;
};

function getToolCallSummary(item: AppServerThreadItem): string {
  if (item.status === "failed") {
    return item.error?.message ?? "工具调用失败。";
  }

  const textParts =
    item.result?.content
      ?.filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text ?? "")
      .filter(Boolean) ?? [];

  if (textParts.length > 0) return textParts.join("\n");
  return item.status === "running" || item.status === "in_progress"
    ? "正在调用自定义工具…"
    : "工具调用完成。";
}

function getAgentCallSummary(item: AppServerThreadItem): string {
  const states = Object.values(item.agentsStates ?? {});
  const running = states.filter((s) => s.status === "running").length;
  const completed = states.filter((s) => s.status === "completed").length;

  if (running > 0) {
    return `${running} 个子 Agent 运行中，${completed} 个已完成。`;
  }
  return `${completed} 个子 Agent 全部完成。`;
}

// 单例连接：同一个 Next.js 服务进程只启动一个 app-server。
// Next.js dev 模式热重载时会重新执行模块，这里用 globalThis 避免 spawn 泄漏。
const globalForAppServer = globalThis as unknown as {
  __codexAppServerConnection?: AppServerConnection;
};

function getConnection(): AppServerConnection {
  // 关键修复：不再用 isReady 判断是否需要重建。
  // 并发请求同时调用时，第一个请求的 initialize 还没完成（isReady=false），
  // 如果这里 dispose 再新建，后续请求会把第一个请求的连接销毁。
  // 正确做法：只要连接对象存在就复用，让 connect() 内部通过 initPromise 去重。
  // 进程崩溃后 exit handler 会重置状态，下一次 connect() 会自动重新 spawn。
  if (!globalForAppServer.__codexAppServerConnection) {
    globalForAppServer.__codexAppServerConnection = new AppServerConnection();
  }
  return globalForAppServer.__codexAppServerConnection;
}

export async function streamCodexReplyViaAppServer(
  options: CodexStreamOptions,
): Promise<void> {
  const requestTracker = beginCodexRequest();
  const connection = getConnection();

  try {
    // 和 exec 路径一样构建 config 覆盖。
    const customToolsEnabled = options.customToolsEnabled ?? true;
    const projectToolsServerCount =
      options.projectToolsServerCount === undefined
        ? 1
        : Number.isInteger(options.projectToolsServerCount) &&
            options.projectToolsServerCount > 0
          ? options.projectToolsServerCount
          : 1;
    const customToolsConfig = customToolsEnabled
      ? buildCustomToolsConfig(projectToolsServerCount)
      : { mcp_servers: {} };
    const customSystemPromptEnabled = options.customSystemPromptEnabled === true;

    const configOverrides: Record<string, unknown> = {
      // 本服务的 app-server 线程都是单请求 ephemeral thread。
      // turn 结束后会显式 thread/unsubscribe；把空闲卸载延迟设为 0，
      // 可以让 MCP runtime 立即 shutdown，避免 stdio 子进程长期常驻。
      thread_unload_delay_secs: 0,
      mcp_servers: {
        ...customToolsConfig.mcp_servers,
        node_repl: { enabled: false },
      },
      plugins: {
        "unified-computer-use@openai-bundled": {
          mcp_servers: {
            cua_repl: { enabled: false },
          },
        },
      },
      developer_instructions: buildMultiAgentInstructions(),
      ...(customSystemPromptEnabled
        ? { model_instructions_file: buildModelInstructionsPath() }
        : {}),
      agents: {
        enabled: true,
        game_designer: {
          description:
            "游戏策划角色，输出玩法规则、界面描述、操作方式和计分机制。",
        },
        game_developer: {
          description:
            "游戏开发角色，根据策划文档写出可直接在浏览器运行的完整 HTML 文件。",
        },
      },
    };

    await connection.connect(configOverrides);

    // 为本次请求创建一个 ephemeral thread，turn 完成后自动回收。
    // 压测不需要跨请求复用 thread；聊天场景可以后续加 thread 池。
    // thread/start 响应结构是 { thread: { id: "..." }, model, ... }，
    // threadId 嵌套在 thread 对象里，不是顶层 threadId 或 id 字段。
    const threadResult = (await connection.request("thread/start", {
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
    })) as { thread?: { id?: string } };
    const threadId = threadResult?.thread?.id;
    if (!threadId) {
      throw new Error("thread/start 未返回 threadId。");
    }

    options.onEvent({ type: "thread", threadId });

    // 通过通知监听器路由本 thread 的事件到回调。
    // 用 AbortSignal 解绑，避免泄漏 handler。
    const abortController = new AbortController();
    options.signal?.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });

    const unsubscribe = connection.onNotification((method, params) => {
      if (abortController.signal.aborted) return;

      // 事件可能来自同一个 app-server 上的其他 thread，
      // 必须按 threadId 过滤，只把当前请求的事件转发给调用方。
      const notificationThreadId =
        (params.threadId as string) ??
        ((params.thread as Record<string, unknown>)?.id as string);
      if (notificationThreadId && notificationThreadId !== threadId) return;

      switch (method) {
        case "item/agentMessage/delta": {
          const delta = params.delta as string | undefined;
          if (delta) {
            options.onEvent({ type: "delta", text: delta });
          }
          break;
        }
        case "item/started":
        case "item/completed": {
          const item = params.item as AppServerThreadItem | undefined;
          if (!item) break;

          if (item.type === "mcpToolCall") {
            const status =
              item.status === "failed"
                ? "failed"
                : item.status === "completed"
                  ? "completed"
                  : "in_progress";
            options.onEvent({
              type: "tool",
              toolId: item.id,
              server: item.server ?? "",
              tool: item.tool ?? "",
              status,
              summary: getToolCallSummary(item),
            });
          }

          if (item.type === "collabAgentToolCall") {
            const status =
              item.status === "failed"
                ? "failed"
                : item.status === "completed"
                  ? "completed"
                  : "in_progress";
            options.onEvent({
              type: "agent",
              toolId: item.id,
              tool: item.tool ?? "",
              status,
              agentCount: item.receiverThreadIds?.length ?? 0,
              summary: getAgentCallSummary(item),
            });
          }
          break;
        }
        case "turn/completed": {
          options.onEvent({ type: "done" });
          abortController.abort();
          break;
        }
        case "error": {
          const message =
            (params.message as string) ?? "codex app-server 返回错误。";
          options.onEvent({ type: "error", message });
          abortController.abort();
          break;
        }
      }
    });

    try {
      await connection.request("turn/start", {
        threadId,
        input: [{ type: "text", text: options.message, text_elements: [] }],
      });

      // turn/start 的响应只表示请求已提交；
      // 实际结果通过 turn/completed 通知异步到达。
      // 等待 done 或 abort 信号。
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          if (options.signal?.aborted) {
            reject(new Error("请求已取消。"));
          } else {
            resolve();
          }
        };
        abortController.signal.addEventListener("abort", onAbort, {
          once: true,
        });
      });

      requestTracker.succeed();
    } finally {
      // 自动 attach 会让长驻 app-server 连接持续持有 thread 订阅。
      // 如果只取消 Node 侧 notification handler，Rust 侧仍认为有 subscriber，
      // thread 不会进入 idle unload，MCP 子进程也会跟着常驻。
      // 因此必须主动发送 thread/unsubscribe，触发 app-server 的完整线程卸载。
      try {
        await connection.request("thread/unsubscribe", { threadId });
      } catch (cleanupError) {
        console.error(
          "[codex-app-server] thread/unsubscribe 失败:",
          cleanupError,
        );
      }
      unsubscribe();
    }
  } catch (error) {
    requestTracker.fail(error);
    throw error;
  }
}
