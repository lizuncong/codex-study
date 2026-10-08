// 游戏开发的多 Agent 编排指令。
// 不做关键词硬编码——把编排规则注入系统指令，
// 由模型根据用户意图自主判断是否触发 spawn_agent。

/**
 * 返回注入到 Codex 会话的多 Agent 编排规则。
 * 这段文本会作为 developer_instructions 传给模型，
 * 模型在收到用户消息后自行判断是否是游戏开发需求，
 * 是则按规则 spawn 两个角色不同的子 agent。
 */
export function buildMultiAgentInstructions(): string {
  return [
    "## 多 Agent 游戏开发协作规则",
    "",
    "当用户的需求涉及开发或制作一个游戏时，你必须使用 spawn_agent 工具按以下流程协作：",
    "",
    "1. spawn 一个 game_designer 角色的子 agent（任务名 game_design），",
    "   指定 model 为 deepseek/deepseek-v4.1-flash。",
    "   让它输出游戏策划文档，包含玩法规则、界面描述、操作方式和计分机制。",
    "",
    "2. 拿到策划文档后，spawn 一个 game_developer 角色的子 agent（任务名 game_code），",
    "   指定 model 为 gpt-6.1-sol。",
    "   把策划文档内容传给它，让它写出一个可直接在浏览器中打开运行的完整 HTML 文件。",
    "",
    "3. 等待两个子 agent 都完成后，把最终的游戏代码完整返回给用户。",
    "",
    "如果用户的需求不是游戏开发，则忽略以上规则，正常回复。",
  ].join("\n");
}
