# Codex SDK 系统提示词自定义

## 背景

Codex 默认根据当前模型渲染一份内置系统提示词（base instructions），SDK 使用方无法直接改它的内容。本项目（codex-study）希望在游戏开发工作台场景下自定义助手人设与全局约束，因此需要走配置覆盖。

## 结论

可以完全覆盖，但配置键与 CLI 版本相关（实测 2026-10-07，codex-cli 0.159.0）：

- `base_instructions`：**0.159.0 不支持**。`--config` 传入未知键时 CLI 会静默忽略（加 `--strict-config` 才报错 `unknown configuration field`），该键是更新的 codex-rs 开发版源码才有的字段。
- `model_instructions_file`：**0.159.0 支持**。指向一个文本文件，内容原样作为系统提示词，内置模板完全不参与渲染。已通过 rollout 实测生效。

验证方法：跑一次 `codex exec -c 'model_instructions_file="/tmp/prompt.md"' "hi"`，然后检查 `~/.codex/sessions/` 下最新 rollout 的 `session_meta.base_instructions.text`，应等于文件内容而非内置提示词。

## 本项目的实现

- `lib/agent-sdk/system-prompt.md`：自定义系统提示词正文（纯文本，整体作为系统提示词，不掺说明注释）。
- `lib/agent-sdk/system-prompt.ts`：导出 `buildModelInstructionsPath()`，返回提示词文件绝对路径（`process.cwd()` 拼接，避免相对路径受启动目录影响）。
- `lib/agent-sdk/codex.ts`：在 `new Codex({ config })` 中新增 `model_instructions_file: buildModelInstructionsPath()`。
- `lib/agent-sdk/codex.ts`：支持 `customSystemPromptEnabled` 开关。只有显式传 `true` 才启用覆盖；普通聊天和压测不传该参数时默认使用 Codex 原生系统提示词。

SDK 序列化细节：字符串值经 `JSON.stringify` 转成合法 TOML basic string，多行文本中的换行会被转义，因此提示词可以放心写成多行。

## 源码链路（codex-rs）

1. SDK 启动 CLI 时传 `--config model_instructions_file=...`，CLI 从文件读取内容合并进 `Config.base_instructions`（`core/src/config/mod.rs`：`base_instructions.or(file_base_instructions).or(cfg.instructions)`，文件键优先于旧 `instructions` 键）。
2. 会话启动时按优先级解析：`config.base_instructions` 覆盖 > fork 历史 > 模型默认模板（`core/src/session/mod.rs`）。配置来源标记为 `BaseInstructionsProvenance::Custom`，后续只有 `Model` 来源才会被后处理（如删 update plan 段落），`Custom` 原样通过。
3. 发请求时作为顶层 `instructions` 字段输出（Responses API），或拼成 developer 片段（Responses Lite）（`core/src/client.rs`）。
4. `spawn_agent` 拉起的子 agent：`build_agent_spawn_config` 会把父会话生效的 base_instructions 原样拷贝进子配置（`core/src/agent/child_config.rs`），所以自定义提示词对所有子 agent 同样生效；`agent_type`（角色）无法单独覆盖系统提示词，只能覆盖 developer 层。

## 三种配置方式与优先级

| 方式 | 说明 | 0.159.0 支持 | 优先级 |
| --- | --- | --- | --- |
| `base_instructions` | 内联文本 | ❌（静默忽略） | 1 |
| `model_instructions_file` | 从文件读取，路径相对 cwd | ✅（本项目采用） | 2 |
| `instructions` | 旧字段别名 | ✅ | 3 |

SDK 场景写在 `CodexOptions.config` 里即可，无需改全局 `config.toml`。

## `model_instructions_file` 版本时间线（2026-10-08 实测）

通过 release tag 的源码文件二分（raw.githubusercontent + `git log -S`）确认：

| 版本 | 日期 | 状态 |
| --- | --- | --- |
| ≤ 0.60.0 | 2025-11 之前 | 不存在 |
| 0.61.0 | 2025-11-20 | 以前身键 `experimental_instructions_file` 首次出现 |
| 0.87.0 | 2026-01-16 | 仍叫 `experimental_instructions_file` |
| 0.88.0 | 2026-01-21 | **更名为 `model_instructions_file`（提交 `f4d55319`，PR #9555，2026-01-20）** |

结论：`model_instructions_file` 从 **0.88.0（2026-01-21）** 开始可用；更早版本只能用 `experimental_instructions_file`。

npm 最新版本（2026-10-08 查询）：`@openai/codex` 与 `@openai/codex-sdk` 的 `latest` 均为 **0.160.1**（2026-10-05 发布），alpha 渠道为 0.162.0-alpha.18（2026-10-07）。

## 分层边界

`base_instructions` 只覆盖 system/instructions 这一层。Codex 还会以独立消息注入以下内容，它们不受本配置控制：

- `developer_instructions`（本项目由 `game-orchestrator.ts` 提供多 Agent 编排规则）
- 项目 `AGENTS.md`、skills 说明、工具描述、环境上下文、多 Agent 协作提示等

即：模型看到的总上下文 = 自定义系统提示词 + 上述附加片段。若需接管 developer 层，可在同一 `config` 对象中再覆盖 `developer_instructions`。
