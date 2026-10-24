import { describe, expect, test } from "bun:test";

import { createLarkSink } from "../src/sinks/lark.js";
import type { LogRecord } from "../src/types.js";

function setup(overrides: Partial<Parameters<typeof createLarkSink>[0]> = {}) {
  const calls: Array<{ url: string; body: string }> = [];
  let clock = 1_000_000;

  const sink = createLarkSink({
    webhook: "https://example.test/hook",
    batchMs: 1000,
    now: () => clock,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response("{}");
    }) as unknown as typeof fetch,
    ...overrides,
  });

  return {
    sink,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const record = (level: LogRecord["level"], msg: string): LogRecord => ({ time: 1, level, msg });

/** 飞书 post 消息：标题在 content.post.zh_cn.title，正文在第一段第一项。 */
function postAt(calls: Array<{ url: string; body: string }>, index = 0): { title: string; text: string } {
  const body = JSON.parse(calls[index]?.body ?? "{}") as {
    content: { post: { zh_cn: { title: string; content: Array<Array<{ text: string }>> } } };
  };
  const zh = body.content.post.zh_cn;
  return { title: zh.title, text: zh.content[0]?.[0]?.text ?? "" };
}

describe("createLarkSink", () => {
  test("默认只推 error", async () => {
    const { sink, calls } = setup();
    sink([record("info", "noise"), record("error", "boom")]);
    await sink.flush();

    expect(calls).toHaveLength(1);
    const { text } = postAt(calls);
    expect(text).toContain("boom");
    expect(text).not.toContain("noise");
  });

  test("一批里的多条合并成一次请求", async () => {
    const { sink, calls } = setup();
    sink([record("error", "a"), record("error", "b"), record("error", "c")]);
    await sink.flush();

    expect(calls).toHaveLength(1);
    const { text, title } = postAt(calls);
    // 三条记录 + 末尾一行发送时间
    expect(text.split("\n").slice(0, 3)).toEqual(["[error] a", "[error] b", "[error] c"]);
    expect(title).toContain("(3)");
  });

  test("超过每分钟配额后丢弃而不是堆积", async () => {
    const { sink, calls } = setup({ maxPerMinute: 1 });

    sink([record("error", "a")]);
    await sink.flush();
    sink([record("error", "b")]);
    await sink.flush();

    expect(calls).toHaveLength(1);
  });

  test("配了 secret 时带上 timestamp 与 sign", async () => {
    const { sink, calls } = setup({ secret: "s3cret" });
    sink([record("error", "a")]);
    await sink.flush();

    const body = JSON.parse(calls[0]?.body as string);
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.sign).toBe("string");
  });

  test("secret 传空串等同于没配：不签名，照常推送", async () => {
    // 空字符串当 HMAC key 会抛 DataError: Zero-length key is not supported，
    // 而 send 的失败在 flush 里被静默吞掉——告警一条都发不出去，还没任何提示。
    const { sink, calls } = setup({ secret: "" });
    sink([record("error", "a")]);
    await sink.flush();

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body as string);
    expect(body.sign).toBeUndefined();
    expect(body.timestamp).toBeUndefined();
  });

  test("fetch 失败时不抛", async () => {
    const { sink } = setup({
      fetch: (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch,
    });
    sink([record("error", "a")]);
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  test("循环引用的记录也能序列化成合法 body", async () => {
    const { sink, calls } = setup({ minLevel: "debug" });
    const circular: Record<string, unknown> = { time: 1, level: "error", msg: "c" };
    circular.self = circular;

    sink([circular as LogRecord]);
    await sink.flush();

    expect(() => JSON.parse(calls[0]?.body as string)).not.toThrow();
  });

  test("文本过长会截断", async () => {
    const { sink, calls } = setup();
    sink([record("error", "x".repeat(30_000))]);
    await sink.flush();

    const { text } = postAt(calls);
    expect(new TextEncoder().encode(text).length).toBeLessThan(25_000);
    expect(text).toContain("…(截断)");
  });
});

describe("错误详情与退出", () => {
  test("logo.error(err) 里带 message 与 stack", async () => {
    const { sink, calls } = setup();
    sink([{ time: 1, level: "error", message: "card declined", stack: "Error: card declined\n    at pay (x.ts:1:1)" }]);
    await sink.flush();

    const { text } = postAt(calls);
    expect(text).toContain("card declined");
    expect(text).toContain("at pay");
  });

  test("close() 把队列里最后一条发出去", async () => {
    const { sink, calls } = setup();
    sink([record("error", "last one")]);
    sink.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toHaveLength(1);
    expect(postAt(calls).text).toContain("last one");
  });

  test("按 UTF-8 字节截断，中文不会超限", async () => {
    const { sink, calls } = setup();
    sink([record("error", "汉".repeat(20_000))]);
    await sink.flush();

    const { text } = postAt(calls);
    expect(new TextEncoder().encode(text).length).toBeLessThan(25_000);
    expect(text).toContain("…(截断)");
  });
});

describe("close 之后", () => {
  test("新记录不再进队列，也不再起定时器", async () => {
    const { sink, calls } = setup();
    sink([record("error", "before")]);
    sink.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sent = calls.length;

    sink([record("error", "after")]);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(calls.length).toBe(sent);
  });
});

describe("标题与一次性通知（照 Go 版 logo）", () => {
  test("标题是 `[Level(batch) titlePrefix]`，正文末尾带发送时间", async () => {
    const { sink, calls } = setup({ titlePrefix: "DEV honox-app 192.168.31.182:8001" });
    sink([record("error", "boom")]);
    await sink.flush();

    const { title, text } = postAt(calls);
    expect(title).toBe("[Error(1) DEV honox-app 192.168.31.182:8001]");
    expect(text.split("\n")).toEqual(["[error] boom", "1970-01-01T08:16:40"]);
  });

  test("没配 titlePrefix 时标题只剩 `[Level(batch)]`", async () => {
    const { sink, calls } = setup({ minLevel: "warn" });
    sink([record("warn", "careful")]);
    sink([record("error", "boom")]);
    await sink.flush();

    // 一批里混了级别：取最高的那个当标题
    expect(postAt(calls).title).toBe("[Error(2)]");
  });

  test("notify 绕过 minLevel 立即发一条，不进队列", async () => {
    const { sink, calls } = setup({ titlePrefix: "DEV app", minLevel: "error" });
    await sink.notify("info", "startup", "{\"version\":\"0.3.51\"}");

    expect(calls).toHaveLength(1);
    const { title, text } = postAt(calls);
    expect(title).toBe("[Info(1) DEV app] startup");
    expect(text).toContain('"version":"0.3.51"');
  });
});
