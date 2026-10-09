# Codex Desktop 浏览器默认实例分析

## 结论

本机安装的 Codex Desktop 实际是 `/Applications/ChatGPT.app`，内部包含：

1. **自带的 in-app browser**：Electron/Chromium 形态，运行时会用 `~/Library/Application Support/Codex` 作为独立 user-data-dir。
2. **外部 Chrome/Edge 控制通道**：不是通过 CDP 启动你的默认浏览器，而是依赖 ChatGPT/Codex 浏览器扩展连接到已经运行的浏览器。

## in-app browser 证据

当前运行中的主进程是：

```text
/Applications/ChatGPT.app/Contents/MacOS/ChatGPT
```

它的 Chromium helper 显示：

```text
--user-data-dir=/Users/lzc/Library/Application Support/Codex
--owl-scoped-user-agent-prefix=CodexBrowser
```

说明 in-app browser 使用的是 Codex Desktop 自己的 profile，不是 `Google Chrome` 的默认 profile。

## 外部 Chrome/Edge 证据

应用内置插件里有：

```text
/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/chrome
```

其中 `SKILL.md` 明确说明该能力用于：

- tabs
- logged-in sessions
- extensions

`extension-ids.json` 定义了 Chrome/Edge 的扩展 ID；文档中的流程是：

1. `agent.browsers.list()` 发现 `extension` 类型的浏览器。
2. `browser.user.openTabs()` 读取用户浏览器中已打开的 tab。
3. `browser.user.claimTab(tab)` 接管指定 tab。

所以外部浏览器登录态可见，是因为扩展运行在用户自己的浏览器 profile 内，而不是 Codex App 直接读取 Chrome 的 cookies。

## 与手动 CDP 的差异

| 方式 | 是否启动默认 profile | 是否需要 CDP | 登录态 |
| --- | ---: | ---: | --- |
| Codex in-app browser | 否，使用 `~/Library/Application Support/Codex` | 否 | 该 profile 内自己的登录态 |
| Codex 外部 Chrome/Edge | 否，接管已运行的浏览器 | 否，通过浏览器扩展 | 用户 profile 内已有登录态 |
| 手动 CDP 调试 | 否，必须独立 `user-data-dir` | 是 | 新独立 profile，默认无登录态 |

因此不能把“Codex 能操作我的浏览器”理解为“Codex 启动了默认 Chrome 实例”。它更像是通过浏览器扩展桥接到已有浏览器会话。

