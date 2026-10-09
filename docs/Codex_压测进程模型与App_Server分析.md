# Codex 压测进程模型与 App Server 分析

## 结论

2026-10-08 12:17:57–12:18:44 这轮压测的并发是 10，10 个请求全部成功。压测启用了 `codex app-server` 路径，因此结论不是“每个 HTTP 请求启动一个 Codex 主进程”，而是：

- 所有请求复用同一个 `codex app-server` 进程。Node 侧用 `globalThis` 保存单例连接，避免 Next.js dev 热重载时重复 spawn。
- 每个请求仍会创建一个 ephemeral thread；本轮出现 10 个 `project_tools` stdio MCP 子进程，说明 MCP 的生命周期粒度仍接近“每请求/每 thread 一个进程”。
- 压测结束后，app-server 和 10 个 `project_tools` 进程仍保留。12:23:05 的实时快照显示 Codex 相关进程仍是 12 个（1 个 Node 包装、1 个 Rust app-server、10 个 MCP），说明当前实现至少存在 MCP 连接保留或清理延迟，需要进一步观察。
- 如果关闭自定义 stdio 工具，纯文本压测应只剩 Next.js、Turbopack PostCSS、Node 包装和 Rust app-server 四个常驻进程，不再随并发数增加 10 个 MCP 子进程。

2026-10-09 优化后：请求结束会发送 `thread/unsubscribe`，app-server 配置 `thread_unload_delay_secs = 0`。ephemeral thread 和本轮 MCP 子进程会立即卸载；app-server 主进程仍保留复用。

## 数据来源

- 通过 Chrome CDP 调试端口 `127.0.0.1:9222` 定位 `/monitor` 页面，并从浏览器 performance entries 恢复压测任务 ID：`5bd1aee7-a497-4e12-9753-5ccb90c3107d`。
- 再通过 `/api/load-test?loadTestId=...` 读取完整任务结果，避免只依赖页面截图中的汇总值。

核心指标如下：

| 指标 | 值 |
| --- | ---: |
| 并发 / 成功 / 失败 | 10 / 10 / 0 |
| 总耗时 | 47.9s |
| 平均耗时 | 34.1s |
| 最快耗时 | 23.9s |
| 最慢耗时 | 47.1s |
| 真实服务进程树 RSS 峰值 | 1.2 GB |
| 真实服务进程树 CPU 峰值 | 130.4% |
| 出现过的进程总数 | 102 |

注意：进程分组表中的“峰值 RSS 合计”和“峰值 CPU 合计”是每个进程各自峰值相加，不是同一秒的真实峰值；本轮各进程峰值 RSS 相加约 1451.8 MB，各进程峰值 CPU 相加约 182.3%。

## 进程分组

| 进程组 | 数量 | 峰值 RSS 合计 | 单进程最高 RSS | 峰值 CPU 合计 | 单进程最高 CPU | 出现时间 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Next.js 服务 | 1 | 442.5 MB | 442.5 MB | 29.6% | 29.6% | 12:17:57–12:18:44 |
| Next.js Turbopack PostCSS | 1 | 70.2 MB | 70.2 MB | 0.5% | 0.5% | 12:17:57–12:18:44 |
| Codex app-server Node 包装 | 1 | 45.1 MB | 45.1 MB | 2.8% | 2.8% | 12:17:57–12:18:44 |
| Codex app-server Rust 主进程 | 1 | 135.6 MB | 135.6 MB | 58.1% | 58.1% | 12:17:58–12:18:44 |
| `project_tools` stdio MCP | 10 | 445.8 MB | 44.7 MB | 30.9% | 5.1% | 12:17:58–12:18:44 |
| OpenAI plugins Git 检查链 | 3 | 25.4 MB | 11.5 MB | 0.5% | 0.5% | 12:17:58–12:17:59 |
| Langfuse marketplace Git 检查链 | 3 | 25.2 MB | 11.5 MB | 0.6% | 0.6% | 12:17:58 |
| Zsh 环境快照主进程 | 31 | 74.3 MB | 4.1 MB | 40.7% | 4.4% | 12:17:58 |
| Zsh 快照子进程 | 40 | 51.9 MB | 1.8 MB | 7.7% | 1.2% | 12:17:58 |
| `SkyComputerUseClient` 通知 | 9 | 132.3 MB | 14.7 MB | 10.9% | 3.2% | 12:18:21–12:18:42 |
| 监控采样 `ps` | 1 | 3.5 MB | 3.5 MB | 0.0% | 0.0% | 12:18:37 |
| 已退出未回收 | 1 | 0 MB | 0 MB | 0.0% | 0.0% | 12:17:58 |

`SkyComputerUseClient` 观察到 9 个，低于请求数 10 的原因是 1 秒采样间隔可能错过短命进程，不代表一定只启动了 9 次。

## 启动原因

- **Next.js 服务 / Turbopack PostCSS**：`pnpm dev` 启动的开发服务和样式编译 worker，用于承载 `/monitor` 和 API。这是本项目的必要常驻部分。
- **Codex app-server Node 包装**：`@openai/codex` 的 `codex.js app-server` 启动器，解析平台后启动真正的 Rust 二进制。
- **Codex app-server Rust 主进程**：实际处理 JSON-RPC、thread/start、turn/start、模型请求和事件通知。本轮 10 个请求共享这一个进程。
- **`project_tools` stdio MCP**：每次 ephemeral thread 初始化 MCP runtime 时启动独立 stdio 子进程。本轮 10 个进程对应 10 个请求/thread，而不是同一个 MCP server 被 10 个工具共用。
- **OpenAI plugins / Langfuse marketplace Git 检查链**：app-server 启动时检查插件 marketplace 是否过期，形成 `git ls-remote`、`git remote-https`、`git-remote-https` 两个链条。它们只在启动阶段出现，不是每个请求一组。
- **Zsh 环境快照**：Codex/thread 初始化 shell 环境时执行 `.zshrc` 并捕获 alias、function、export 等状态，纯文本压测不需要。
- **`SkyComputerUseClient` 通知**：全局 notify hook 在 turn ended 时启动的短命通知进程，纯压测不需要。
- **监控采样 `ps`**：监控页采集进程树时产生的短命进程。
- **defunct**：已经退出、等待父进程回收的僵尸进程，不占 RSS/CPU。

## 与旧 `codex exec` 路径的差异

旧路径由每次请求创建一个新的 `Codex` 实例并启动 `codex exec --experimental-json`，因此并发 10 会出现 10 个 Codex CLI 主进程。参考线程中也确认了这个模型。

新路径在 `lib/agent-sdk/codex.ts` 中根据 `appServerEnabled` 转到 app-server 实现；`lib/codex-app-server/stream.ts` 使用全局单例连接，每个请求调用 `thread/start` 创建 ephemeral thread。主进程模型从“每请求一个 Codex”变成“多请求共享一个 Codex”。

## 风险与优化方向

1. **MCP 进程数量仍随并发请求数增长**：这是请求执行期间的预期行为；请求结束后已通过 `thread/unsubscribe` 和零延迟 unload 释放。纯文本压测仍可以关闭 `Codex stdio 自定义工具调用`。
2. **混合配置存在先到先得问题**：app-server 连接只会用第一次 `connect(configOverrides)` 的配置启动一次。并发请求如果携带不同 `mcp_servers`、系统提示词或 agent 配置，后续请求的进程级覆盖不会生效。当前压测所有请求配置相同，所以没有触发差异。
3. **减少非核心启动副作用**：纯压测可以禁用插件 marketplace 检查、Langfuse、turn-ended notify 和 shell snapshot，显著减少 Git 链、Zsh 链和通知进程。
4. **压测指标不要用进程峰值相加替代真实峰值**：页面已经记录真实服务进程树峰值，分组表只能用来解释进程来源。
