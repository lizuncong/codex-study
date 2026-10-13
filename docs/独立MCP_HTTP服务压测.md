# 独立 MCP HTTP 服务压测

## 目的

STDIO MCP 的进程粒度是每个 Codex 线程一个子进程。压测并发高时，`project_tools` 会按请求数量放大，内存也会线性增长。

新增的 Streamable HTTP MCP 模式把工具执行放到一个独立服务里。多个 Codex 线程只建立 HTTP 客户端连接，不再各自拉起一个 MCP 子进程。

## 启动独立服务

```bash
pnpm mcp:http
```

默认监听：

```text
http://127.0.0.1:8787/mcp
```

可用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_HTTP_PORT` | `8787` | HTTP 监听端口 |
| `MCP_HTTP_HOST` | `127.0.0.1` | 监听地址 |
| `MCP_HTTP_URL` | `http://127.0.0.1:8787/mcp` | Codex 注册的 MCP URL |
| `CUSTOM_TOOLS_ROOT` | `process.cwd()` | 工具允许读取的项目根目录 |

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## 压测开关

压测抽屉新增「启用独立 MCP 服务」复选框，默认关闭：

- 关闭：沿用原来的 STDIO MCP 配置。
- 开启：`project_tools` 注册为 Streamable HTTP server。
- 开启后「stdio MCP 多进程验证」会被禁用，两种进程模型互斥。

开启开关前必须先启动独立服务；服务未启动时，Codex 初始化 MCP 会失败。

## 服务实现

`mcp-server/server.mjs` 是零依赖 Node HTTP 服务：

- 复用 `scripts/customToolsMcp` 现有工具注册中心。
- 支持 `initialize`、`ping`、`tools/list`、`tools/call`。
- 使用无会话 Streamable HTTP 模式，每次 POST 独立处理。
- 默认只绑定 `127.0.0.1`，避免无意暴露文件读取能力。

可用工具与 STDIO 模式一致：

- `get_project_info`
- `read_project_file`
