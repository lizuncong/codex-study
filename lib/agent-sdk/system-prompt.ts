// Codex 会话的系统提示词覆盖。
// 当前安装的 codex-cli 0.159.0 不支持 base_instructions 配置键（未知键会被静默忽略），
// 支持的是等价键 model_instructions_file：从文件读取系统提示词，生效后 CLI 会把
// 文件内容原样作为 API 请求的 instructions 字段发出，内置模板不再参与渲染。
// 提示词正文维护在同目录的 system-prompt.md。

import path from "node:path";

/**
 * 返回自定义系统提示词文件的绝对路径。
 * 文件内容会完全覆盖 Codex 内置的系统提示词，
 * 并被 spawn_agent 拉起的子 agent 原样继承，
 * 因此提示词中的人设和全局约束对主 agent 与所有子 agent 一致生效。
 * 使用 process.cwd() 拼绝对路径，避免 CLI 相对路径解析受启动目录影响。
 */
export function buildModelInstructionsPath(): string {
  return path.join(process.cwd(), "lib", "agent-sdk", "system-prompt.md");
}
