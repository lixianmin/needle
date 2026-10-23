import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { createFetchAdapter } from "../../packages/shell/src/ui/fetch-adapter.js";
import type { ShellEvent } from "../../packages/shell/src/ui/adapter.js";

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  const window = new Window({ url: "http://localhost/" });
  (globalThis as unknown as { localStorage: Storage }).localStorage = window.localStorage as unknown as Storage;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("重连", () => {
  test("重新订阅时只 abort 旧连接，旧轮次不会再排一次重连", async () => {
    const calls: Array<AbortSignal | null | undefined> = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      calls.push(signal);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('event: handshake\ndata: {"title":"t","version":"1","user":"u","commands":[],"topics":[]}\n\n'),
          );
          signal?.addEventListener("abort", () => {
            try {
              controller.error(new DOMException("aborted", "AbortError"));
            } catch {
              // 流已经关了
            }
          });
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    localStorage.setItem("logo.shell.token", "token");
    const adapter = createFetchAdapter({ basePath: "" });
    const events: ShellEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.some((event) => event.type === "handshake")).toBe(true);

    // 改变订阅 = 重连：旧连接被 abort。
    adapter.setTopics("top");

    await new Promise((resolve) => setTimeout(resolve, 1200));

    // 只有两次连接，没有被 abort 的旧轮次反复重连；也没有“连接失败”刷屏。
    expect(calls).toHaveLength(2);
    expect(events.filter((event) => event.type === "status" && event.level === "error")).toHaveLength(0);

    unsubscribe();
  });
});

describe("未登录提示", () => {
  test("没有 token 时一个 /events 请求都不发，直接提示", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const adapter = createFetchAdapter({ basePath: "" });
    const events: ShellEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls).toBe(0);
    const status = events.find((event) => event.type === "status");
    expect(status?.type === "status" && status.message).toContain("auth");
    unsubscribe();
  });

  test("token 失效（401）时提示 auth 与 help，并清掉 token", async () => {
    localStorage.setItem("logo.shell.token", "stale");
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const adapter = createFetchAdapter({ basePath: "" });
    const events: ShellEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(localStorage.getItem("logo.shell.token")).toBeNull();

    const status = events.find((event) => event.type === "status");
    expect(status?.type).toBe("status");
    if (status?.type === "status") {
      expect(status.message).toContain("auth");
      expect(status.message).toContain("help");
    }
    unsubscribe();
  });
});
