"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatRequest, ChatStreamEvent } from "@/types/chat";

function createMessage(role: ChatMessage["role"], content = ""): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
  };
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = input.trim();

    if (!prompt || isStreaming) {
      return;
    }

    setInput("");
    setError(null);
    setIsStreaming(true);
    const userMessage = createMessage("user", prompt);
    const assistantMessage = createMessage("assistant");
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      const requestBody: ChatRequest = {
        message: prompt,
        threadId,
      };
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => null);
        throw new Error(
          typeof result?.error === "string" ? result.error : "发送请求失败。",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const streamEvent = JSON.parse(line) as ChatStreamEvent;

          if (streamEvent.type === "thread") {
            setThreadId(streamEvent.threadId);
          } else if (streamEvent.type === "delta") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: message.content + streamEvent.text }
                  : message,
              ),
            );
          } else if (streamEvent.type === "message") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: streamEvent.text }
                  : message,
              ),
            );
          } else if (streamEvent.type === "tool") {
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantMessage.id) {
                  return message;
                }

                const tools = message.tools ?? [];
                const existingIndex = tools.findIndex(
                  (toolCall) => toolCall.id === streamEvent.toolId,
                );
                const nextToolCall = {
                  id: streamEvent.toolId,
                  server: streamEvent.server,
                  tool: streamEvent.tool,
                  status: streamEvent.status,
                  summary: streamEvent.summary,
                };

                if (existingIndex === -1) {
                  return { ...message, tools: [...tools, nextToolCall] };
                }

                return {
                  ...message,
                  tools: tools.with(existingIndex, nextToolCall),
                };
              }),
            );
          } else if (streamEvent.type === "agent") {
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantMessage.id) {
                  return message;
                }

                const agents = message.agents ?? [];
                const existingIndex = agents.findIndex(
                  (agent) => agent.id === streamEvent.toolId,
                );
                const nextAgent = {
                  id: streamEvent.toolId,
                  tool: streamEvent.tool,
                  status: streamEvent.status,
                  agentCount: streamEvent.agentCount,
                  summary: streamEvent.summary,
                };

                if (existingIndex === -1) {
                  return { ...message, agents: [...agents, nextAgent] };
                }

                return {
                  ...message,
                  agents: agents.with(existingIndex, nextAgent),
                };
              }),
            );
          } else if (streamEvent.type === "error") {
            throw new Error(streamEvent.message);
          }
        }
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "发送请求失败。";
      setError(message);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
        <header className="pb-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight">Codex 聊天</h1>
            <Link
              href="/monitor"
              className="flex h-10 items-center rounded-xl border border-black/10 bg-white px-4 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              监控
            </Link>
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            输入问题，Codex 会流式返回回复。
          </p>
        </header>

        <section
          ref={scrollRef}
          className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-950"
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                从下面输入你的第一个问题。
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "bg-zinc-950 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950"
                      : "border border-black/5 bg-zinc-100 dark:border-white/10 dark:bg-zinc-900"
                  }`}
                >
                  {message.role === "assistant" && message.tools ? (
                    <div className="mb-3 flex flex-col gap-2">
                      {message.tools.map((toolCall) => (
                        <div
                          key={toolCall.id}
                          className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <span
                              className={`size-1.5 rounded-full ${
                                toolCall.status === "in_progress"
                                  ? "animate-pulse bg-amber-500"
                                  : toolCall.status === "completed"
                                    ? "bg-emerald-500"
                                    : "bg-red-500"
                              }`}
                            />
                            {toolCall.server} / {toolCall.tool}
                          </div>
                          {toolCall.summary ? (
                            <p className="mt-1 whitespace-pre-wrap break-all text-zinc-600 dark:text-zinc-400">
                              {toolCall.summary}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.role === "assistant" && message.agents ? (
                    <div className="mb-3 flex flex-col gap-2">
                      {message.agents.map((agent) => (
                        <div
                          key={agent.id}
                          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs dark:border-indigo-900 dark:bg-indigo-950/30"
                        >
                          <div className="flex items-center gap-2 font-medium text-indigo-700 dark:text-indigo-300">
                            <span
                              className={`size-1.5 rounded-full ${
                                agent.status === "in_progress"
                                  ? "animate-pulse bg-indigo-500"
                                  : agent.status === "completed"
                                    ? "bg-emerald-500"
                                    : "bg-red-500"
                              }`}
                            />
                            🤖 {agent.tool}
                            {agent.agentCount > 0 ? (
                              <span className="ml-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-normal text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300">
                                {agent.agentCount} agent
                              </span>
                            ) : null}
                          </div>
                          {agent.summary ? (
                            <p className="mt-1 text-indigo-600 dark:text-indigo-400">
                              {agent.summary}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.role === "assistant" && !message.content ? (
                    <span className="inline-flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                      <span className="size-1.5 animate-pulse rounded-full bg-current" />
                      正在生成回复…
                    </span>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))
          )}
        </section>

        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <form onSubmit={sendMessage} className="mt-4">
          <div className="flex items-end gap-3 rounded-2xl border border-black/10 bg-white p-3 shadow-sm transition-colors focus-within:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:focus-within:border-zinc-600">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
            placeholder="向 Codex 发送消息…"
              className="max-h-40 flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-zinc-500"
              disabled={isStreaming}
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="h-10 shrink-0 rounded-xl bg-zinc-950 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
            >
              {isStreaming ? "发送中" : "发送"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-500 dark:text-zinc-500">
            <p>Enter 发送，Shift + Enter 换行。</p>
            <p>自定义工具：get_project_info、read_project_file。</p>
          </div>
        </form>
      </main>
    </div>
  );
}
