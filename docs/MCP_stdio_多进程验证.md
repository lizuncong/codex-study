# MCP stdio 多进程验证

这个验证用于确认：stdio MCP server 的进程粒度是 **每个启用的 server 配置一个子进程**，而不是每个工具一个子进程。

## 修改点

- `buildCustomToolsConfig(serverCount)` 支持把同一个 `project_tools` 脚本注册为多个 MCP server。
- 压测抽屉里的 `stdio MCP 多进程验证` 复选框开启时，每个请求注册 3 个 MCP server；默认仍注册 1 个，普通运行不受影响。
- 该开关依赖 `Codex stdio 自定义工具调用` 复选框；主开关关闭时多进程验证不可用。

## 验证步骤

```bash
pnpm dev
```

打开 `/monitor`，进入压测设置，勾选：

1. `Codex stdio 自定义工具调用`
2. `stdio MCP 多进程验证`

另开一个终端，先记录 `customToolsMcp/index.mjs` 相关进程数量：

```bash
ps -Ao pid=,ppid=,etime=,rss=,args= | grep '[c]ustomToolsMcp/index.mjs'
```

然后启动压测，触发 Codex 初始化 MCP。请求执行期间再次查看：

```bash
ps -Ao pid=,ppid=,etime=,rss=,args= | grep '[c]ustomToolsMcp/index.mjs'
```

预期结果：

- 未发送请求时，通常是 0 个 MCP 子进程。
- 请求初始化 MCP 时，应看到 3 个 `node .../scripts/customToolsMcp/index.mjs` 进程。
- 它们的父进程都指向当前请求启动的 `codex exec` 进程。
- 请求结束后，这些子进程会随 MCP 连接关闭而退出。

也可以打开 `/monitor` 页面查看 Codex 进程树，但 `ps` 命令能更直接地按脚本路径确认 MCP 子进程数量。
