import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { createFetchAdapter } from "../src/ui/fetch-adapter.js";
import type { HandshakeInfo, ShellEvent } from "../src/ui/adapter.js";

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
    const events:ShellEvent[] = [];
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
    const events:ShellEvent[] = [];
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
    const events:ShellEvent[] = [];
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

/** 把一串文本当成 SSE 流交出去；chunk 边界由调用方决定。 */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

/** 记录每次请求，按 url 决定响应。 */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

const COMMANDS: HandshakeInfo["commands"] = [];

function handshakeFrame(): string {
  return `event: handshake\ndata: ${JSON.stringify({ title: "t", version: "1", user: "u", commands: COMMANDS, topics: [] })}\n\n`;
}

describe("exec", () => {
  test("成功：输出取 body.data，token 进 Authorization 头", async () => {
    localStorage.setItem("logo.shell.token", "t1");
    const calls = stubFetch(() => Response.json({ data: { kind: "text", text: "hi" } }));

    const adapter = createFetchAdapter({ basePath: "/shell" });
    const result = await adapter.exec("ps");

    expect(result).toEqual({ ok: true, output: { kind: "text", text: "hi" } });
    expect(calls[0]?.url).toBe("/shell/exec");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer t1",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ line: "ps" });
  });

  test("没有 token 时不带 Authorization 头", async () => {
    const calls = stubFetch(() => Response.json({ data: { kind: "text", text: "hi" } }));

    await createFetchAdapter({ basePath: "" }).exec("ps");

    expect(calls[0]?.init?.headers).not.toHaveProperty("authorization");
  });

  test("401：清掉 token，结果标 unauthorized", async () => {
    localStorage.setItem("logo.shell.token", "stale");
    stubFetch(() => new Response("no", { status: 401 }));

    const result = await createFetchAdapter({ basePath: "" }).exec("ps");

    expect(result).toEqual({ ok: false, error: "unauthorized", unauthorized: true });
    expect(localStorage.getItem("logo.shell.token")).toBeNull();
  });

  test("其它失败：文案取响应体里的 message", async () => {
    stubFetch(() => Response.json({ code: "bad_request", message: "参数不对" }, { status: 400 }));

    expect(await createFetchAdapter({ basePath: "" }).exec("x")).toEqual({
      ok: false,
      error: "参数不对",
    });
  });

  test("失败且响应不是 JSON：退回状态码文案", async () => {
    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));

    expect(await createFetchAdapter({ basePath: "" }).exec("x")).toEqual({
      ok: false,
      error: "请求失败（HTTP 502）",
    });
  });
});

describe("fetchFile", () => {
  test("带 token 取全文", async () => {
    localStorage.setItem("logo.shell.token", "t1");
    const calls = stubFetch(() => new Response("line1\nline2", { status: 200 }));

    const result = await createFetchAdapter({ basePath: "" }).fetchFile("/log/a");

    expect(result).toEqual({ ok: true, text: "line1\nline2" });
    expect(calls[0]?.url).toBe("/log/a");
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: "Bearer t1" });
  });

  test("401 与 5xx 都转成 error，不抛", async () => {
    stubFetch((url) => {
      if (url === "/log/secret") {
        return new Response("no", { status: 401 });
      }

      return Response.json({ message: "读不出来" }, { status: 500 });
    });

    const adapter = createFetchAdapter({ basePath: "" });
    expect(await adapter.fetchFile("/log/secret")).toEqual({
      ok: false,
      error: "未登录：先执行 auth <user>",
    });
    expect(await adapter.fetchFile("/log/broken")).toEqual({ ok: false, error: "读不出来" });
  });

  test("网络层异常也转成 error", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const result = await createFetchAdapter({ basePath: "" }).fetchFile("/log/a");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Failed to fetch");
  });
});

describe("authenticate", () => {
  test("成功：写 token，并立刻用新 token 重连", async () => {
    const calls = stubFetch((url) => {
      if (url === "/shell/auth") {
        return Response.json({ user: "u1", token: "new-token" });
      }

      return new Response(streamOf([handshakeFrame()]), { status: 200 });
    });

    const adapter = createFetchAdapter({ basePath: "/shell" });
    const unsubscribe = adapter.subscribe(() => {});
    const result = await adapter.authenticate("u1", "pw");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result).toEqual({ ok: true, user: "u1" });
    expect(localStorage.getItem("logo.shell.token")).toBe("new-token");
    // 先 /auth 再 /events，且重连带的是新 token
    expect(calls.map((call) => call.url)).toEqual(["/shell/auth", "/shell/events"]);
    expect(calls[1]?.init?.headers).toMatchObject({ authorization: "Bearer new-token" });
    unsubscribe();
  });

  test("失败：用服务端的 message；没有 message 时退回状态码", async () => {
    let round = 0;
    stubFetch(() => {
      round += 1;
      return round === 1
        ? Response.json({ message: "口令错" }, { status: 401 })
        : Response.json({}, { status: 500 });
    });

    const adapter = createFetchAdapter({ basePath: "" });
    expect(await adapter.authenticate("u", "bad")).toEqual({ ok: false, error: "口令错" });
    expect(await adapter.authenticate("u", "bad")).toEqual({
      ok: false,
      error: "登录失败（HTTP 500）",
    });
    expect(localStorage.getItem("logo.shell.token")).toBeNull();
  });

  test("响应里没有 token 也算失败，不写脏 token", async () => {
    stubFetch(() => Response.json({ user: "u1" }));

    expect(await createFetchAdapter({ basePath: "" }).authenticate("u1", "pw")).toEqual({
      ok: false,
      error: "登录失败（HTTP 200）",
    });
  });
});

describe("帧解析", () => {
  test("跨 chunk 的半帧、未知事件、坏 JSON 都不炸", async () => {
    localStorage.setItem("logo.shell.token", "t1");
    const frames = [
      handshakeFrame(),
      `event: log\ndata: ${JSON.stringify([{ time: "1", level: "info" }])}\n\n`,
      'event: topic\ndata: {"name":"top","error":"读不到"}\n\n',
      'event: weird\ndata: "x"\n\n',
      "event: log\ndata: not-json\n\n",
    ].join("");
    // 切点落在第二帧中间：半帧必须留到下一个 chunk
    const cut = frames.indexOf("event: log") + 9;
    stubFetch(() => new Response(streamOf([frames.slice(0, cut), frames.slice(cut)]), { status: 200 }));

    const adapter = createFetchAdapter({ basePath: "" });
    const events: ShellEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => void events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(events.filter((event) => event.type === "handshake")).toHaveLength(1);
    expect(events.filter((event) => event.type === "logs")).toHaveLength(1);
    // topic 只有 error 时把 error 当 data，不渲染成 undefined
    expect(events.find((event) => event.type === "topic")).toEqual({
      type: "topic",
      name: "top",
      data: "读不到",
    });
    unsubscribe();
  });

  test("token 有效但服务端给 401 之外的空正文：报错并退避重连", async () => {
    localStorage.setItem("logo.shell.token", "t1");
    let round = 0;
    stubFetch(() => {
      round += 1;
      return new Response(null, { status: 200 });
    });

    const adapter = createFetchAdapter({ basePath: "" });
    const events: ShellEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => void events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const error = events.find((event) => event.type === "status" && event.level === "error");
    expect(error?.type === "status" && error.message).toContain("empty event stream");
    // 第一轮失败后按退避重连（500 * 2^1 = 1000ms），等下让它真的重来一次
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(round).toBe(2);
    unsubscribe();
  });
});
