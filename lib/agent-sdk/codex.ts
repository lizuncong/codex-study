import { Codex } from "@openai/codex-sdk";
import { beginCodexRequest } from "@/lib/monitor/request-metrics";
import { buildCustomToolsConfig } from "@/lib/agent-sdk/custom-tools";
import {
  buildMultiAgentInstructions,
} from "@/lib/agent-sdk/game-orchestrator";
import { buildModelInstructionsPath } from "@/lib/agent-sdk/system-prompt";
import {
  getToolCallSummary,
  getAgentCallSummary,
  isAgentMessageEvent,
  isMcpToolCallEvent,
  type CollabToolCallRawItem,
} from "@/lib/agent-sdk/codex-events";
import type { CodexStreamOptions } from "@/types/codex";

const threadOptions = {
  // 不请求人工审批：Codex 可以直接执行当前回合内允许的操作。
  approvalPolicy: "never",

  // 只读沙箱：Codex 只能读取工作目录，不能写入文件或修改系统状态。
  sandboxMode: "read-only",
} as const;

export async function streamCodexReply(
  options: CodexStreamOptions,
): Promise<void> {
  const requestTracker = beginCodexRequest();

  try {
    // 聊天和压测默认启用自定义工具；压测可以显式关闭，用于对比工具注册带来的资源消耗。
    const customToolsEnabled = options.customToolsEnabled ?? true;
    // 压测面板可以显式开启多进程验证；普通聊天不传该参数时保持单 server 行为。
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
    // 只有调用方显式开启才覆盖内置系统提示词；普通聊天不传时使用 Codex 原生模板。
    const customSystemPromptEnabled = options.customSystemPromptEnabled === true;

    const codex = new Codex({
      config: {
        // node_repl 是全局配置注册的 Node REPL MCP 服务。
        // cua_repl 是 unified-computer-use 插件提供的桌面/浏览器自动化 MCP，
        // 它会再启动 node_repl 作为子进程。SDK 聊天场景都不需要。
        // 注意：插件 MCP 必须通过 plugins.<plugin-id>.mcp_servers 覆盖；
        // 直接放 mcp_servers.cua_repl 会生成缺少 transport 的无效配置。
        mcp_servers: {
          // 必须合并而不是覆盖，否则 project_tools 会在这里被丢弃。
          ...customToolsConfig.mcp_servers,
          node_repl: {
            enabled: false,
          },
        },
        plugins: {
          "unified-computer-use@openai-bundled": {
            mcp_servers: {
              cua_repl: {
                enabled: false,
              },
          },
        },
        },
        // 多 Agent 游戏开发协作规则，作为 developer_instructions 注入模型上下文。
        // 模型根据用户意图自主判断是否 spawn 子 agent，不做关键词硬编码。
        developer_instructions: buildMultiAgentInstructions(),
        ...(customSystemPromptEnabled
          ? {
              // 自定义系统提示词：完全覆盖 Codex 内置模板。
              // codex-cli 0.159.0 不认识 base_instructions 键，
              // 必须用等价键 model_instructions_file 指向提示词文件。
              // spawn_agent 拉起的子 agent 也会继承这份系统提示词。
              model_instructions_file: buildModelInstructionsPath(),
            }
          : {}),
        // 启用多 Agent 协作。
        // agents.enabled 默认就是 true，显式声明便于后续调整并发数和角色定义。
        // 是否实际使用取决于模型能力：支持 V2 的模型会获得 spawn_agent 等工具。
        agents: {
          enabled: true,
          // 游戏开发场景的两个角色，模型的 spawn_agent 工具会在 agent_type 参数中展示它们。
          game_designer: {
            description: "游戏策划角色，输出玩法规则、界面描述、操作方式和计分机制。",
          },
          game_developer: {
            description: "游戏开发角色，根据策划文档写出可直接在浏览器运行的完整 HTML 文件。",
          },
        },
      },
    });
    const thread = options.threadId
      ? codex.resumeThread(options.threadId, threadOptions)
      : codex.startThread(threadOptions);

    const { events } = await thread.runStreamed(options.message, {
      // 调用方执行 abortController.abort() 时， signal 会进入 aborted 状态，SDK 就会取消当前正在运行的 Codex 回合并停止接收事件流。
      signal: options.signal,
    });
    const messageTexts = new Map<string, string>();

    for await (const event of events) {
      if (event.type === "thread.started") {
        options.onEvent({ type: "thread", threadId: event.thread_id });
        continue;
      }

      if (isAgentMessageEvent(event)) {
        const previousText = messageTexts.get(event.item.id) ?? "";

        if (event.item.text !== previousText) {
          if (event.item.text.startsWith(previousText)) {
            options.onEvent({
              type: "delta",
              text: event.item.text.slice(previousText.length),
            });
          } else {
            options.onEvent({ type: "message", text: event.item.text });
          }

          messageTexts.set(event.item.id, event.item.text);
        }

        continue;
      }

      if (isMcpToolCallEvent(event)) {
        options.onEvent({
          type: "tool",
          toolId: event.item.id,
          server: event.item.server,
          tool: event.item.tool,
          status: event.item.status,
          summary: getToolCallSummary(event.item),
        });
        continue;
      }

      // 多 Agent 协作工具调用（spawn_agent 等）。
      // 事件流的 item.type 是 "collab_tool_call"，SDK 类型还没收录但 JSON 会透传。
      if (
        (event.type === "item.started" ||
          event.type === "item.updated" ||
          event.type === "item.completed") &&
        (event.item as Record<string, unknown>).type === "collab_tool_call"
      ) {
        // SDK 的 ThreadItem 联合类型还没收录 collab_tool_call，
        // 但底层 JSON 会透传，这里安全地做一次窄化断言。
        const item = event.item as unknown as CollabToolCallRawItem;

        options.onEvent({
          type: "agent",
          toolId: item.id,
          tool: item.tool,
          status: item.status as "in_progress" | "completed" | "failed",
          agentCount: item.receiver_thread_ids?.length ?? 0,
          summary: getAgentCallSummary(item),
        });
        continue;
      }

      if (event.type === "turn.completed") {
        options.onEvent({ type: "done" });
        continue;
      }

      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    requestTracker.succeed();
  } catch (error) {
    requestTracker.fail(error);
    throw error;
  }
}
