import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * codex app-server 通过 stdin/stdout 交换 newline-delimited JSON。
 * 请求带 id，响应带匹配的 id；通知没有 id，用 method 字段路由。
 * 这里实现最小 JSON-RPC 客户端，只覆盖 thread/start 和 turn/start 流程。
 */
type JsonRpcRequest = {
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type WireMessage = JsonRpcResponse | JsonRpcNotification;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type NotificationHandler = (
  method: string,
  params: Record<string, unknown>,
) => void;

/**
 * 解析 codex 二进制路径。
 * 优先从 @openai/codex 的 vendor 目录找平台包，
 * 找不到就退回 PATH 上的 codex 命令。
 */
function resolveBinaryPath(): string {
  try {
    const require = createRequire(import.meta.url);
    const codexPackageJson = require.resolve("@openai/codex/package.json");
    const codexPackageDir = path.dirname(codexPackageJson);
    const platformDir =
      process.platform === "darwin" ? "darwin-arm64" : process.platform;
    const vendorBinary = path.join(
      codexPackageDir,
      "vendor",
      platformDir,
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    if (existsSync(vendorBinary)) {
      return vendorBinary;
    }
  } catch {
    // @openai/codex 不在依赖树中时退回 PATH。
  }
  return "codex";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTomlValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => toTomlValue(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const parts = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}=${toTomlValue(v)}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * 把嵌套 config 对象扁平化为 codex CLI 的 -c key=value 格式。
 * 复用与 @openai/codex-sdk 相同的 flatten + TOML 序列化逻辑。
 */
function serializeConfigOverrides(
  config: Record<string, unknown>,
): string[] {
  const overrides: string[] = [];
  flattenConfig(config, "", overrides);
  return overrides;
}

function flattenConfig(
  value: unknown,
  prefix: string,
  overrides: string[],
): void {
  if (!isPlainObject(value)) {
    if (prefix) {
      overrides.push(`${prefix}=${toTomlValue(value)}`);
    }
    return;
  }

  const entries = Object.entries(value);
  if (prefix && entries.length === 0) {
    overrides.push(`${prefix}={}`);
    return;
  }

  for (const [key, child] of entries) {
    if (child === undefined) continue;
    const dotPath = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child)) {
      flattenConfig(child, dotPath, overrides);
    } else {
      overrides.push(`${dotPath}=${toTomlValue(child)}`);
    }
  }
}

/**
 * 一个 app-server 进程对应一个 Connection。
 * 多个 thread 复用同一个进程，省去每次 spawn 的冷启动和内存开销。
 */
export class AppServerConnection {
  private process: ChildProcess | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationHandlers = new Set<NotificationHandler>();
  private buffer = "";
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  /**
   * 启动 app-server 进程并发送 initialize 握手。
   * configOverrides 会变成 -c 标志，对所有 thread 生效。
   * 进程崩溃后可以重新调用 connect 来重启。
   */
  async connect(configOverrides?: Record<string, unknown>): Promise<void> {
    // 同时检查 isInitialized 和 process，
    // 因为进程退出后 isInitialized 会被 exit handler 重置为 false。
    if (this.isInitialized && this.process) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doConnect(configOverrides);
    return this.initPromise;
  }

  private async doConnect(
    configOverrides?: Record<string, unknown>,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("App-server connection 已被销毁，无法重连。");
    }

    const binaryPath = resolveBinaryPath();
    const args = ["app-server"];

    if (configOverrides) {
      for (const override of serializeConfigOverrides(configOverrides)) {
        args.push("-c", override);
      }
    }

    this.process = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        LOG_FORMAT: "json",
        RUST_LOG: process.env.RUST_LOG ?? "warn",
      },
    });

    this.process.stdout?.setEncoding("utf8");
    this.process.stdout?.on("data", (chunk: string) => {
      this.handleStdoutData(chunk);
    });

    this.process.stderr?.setEncoding("utf8");
    this.process.stderr?.on("data", (chunk: string) => {
      console.error("[codex-app-server stderr]", chunk.trim());
    });

    this.process.on("exit", () => {
      this.rejectAllPending(new Error("codex app-server 进程已退出。"));
      this.process = null;
      this.isInitialized = false;
      this.initPromise = null;
    });

    this.process.on("error", (error) => {
      this.rejectAllPending(
        new Error(`codex app-server 启动失败: ${error.message}`),
      );
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codex-study",
        version: "0.1.0",
      },
      capabilities: {},
    });

    this.isInitialized = true;
  }

  private handleStdoutData(chunk: string): void {
    this.buffer += chunk;

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let message: WireMessage;
      try {
        message = JSON.parse(line) as WireMessage;
      } catch {
        continue;
      }

      if ("id" in message && typeof message.id === "number") {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
        continue;
      }

      if ("method" in message && typeof message.method === "string") {
        for (const handler of this.notificationHandlers) {
          handler(
            message.method,
            (message.params ?? {}) as Record<string, unknown>,
          );
        }
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error("codex app-server 进程不可用。"));
    }

    const id = this.nextRequestId++;
    const request: JsonRpcRequest = { id, method, params };
    const line = `${JSON.stringify(request)}\n`;

    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process?.stdin?.write(line, (writeError) => {
        if (writeError) {
          this.pendingRequests.delete(id);
          reject(writeError);
        }
      });
    });
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  get isReady(): boolean {
    return this.isInitialized && this.process !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAllPending(new Error("App-server connection 已销毁。"));
    this.notificationHandlers.clear();
    this.process?.kill();
    this.process = null;
    this.isInitialized = false;
    this.initPromise = null;
  }
}
