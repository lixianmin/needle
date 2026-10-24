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

describe("createLarkSink", () => {
  test("默认只推 error", async () => {
    const { sink, calls } = setup();
    sink([record("info", "noise"), record("error", "boom")]);
    await sink.flush();

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body as string).content.text).toContain("boom");
    expect(JSON.parse(calls[0]?.body as string).content.text).not.toContain("noise");
  });

  test("一批里的多条合并成一次请求", async () => {
    const { sink, calls } = setup();
    sink([record("error", "a"), record("error", "b"), record("error", "c")]);
    await sink.flush();

    expect(calls).toHaveLength(1);
    const text = JSON.parse(calls[0]?.body as string).content.text as string;
    expect(text.split("\n")).toHaveLength(3);
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

    const text = JSON.parse(calls[0]?.body as string).content.text as string;
    expect(new TextEncoder().encode(text).length).toBeLessThan(25_000);
    expect(text.endsWith("…(截断)")).toBe(true);
  });
});

describe("错误详情与退出", () => {
  test("logo.error(err) 里带 message 与 stack", async () => {
    const { sink, calls } = setup();
    sink([{ time: 1, level: "error", message: "card declined", stack: "Error: card declined\n    at pay (x.ts:1:1)" }]);
    await sink.flush();

    const text = JSON.parse(calls[0]?.body as string).content.text;
    expect(text).toContain("card declined");
    expect(text).toContain("at pay");
  });

  test("close() 把队列里最后一条发出去", async () => {
    const { sink, calls } = setup();
    sink([record("error", "last one")]);
    sink.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body as string).content.text).toContain("last one");
  });

  test("按 UTF-8 字节截断，中文不会超限", async () => {
    const { sink, calls } = setup();
    sink([record("error", "汉".repeat(20_000))]);
    await sink.flush();

    const text = JSON.parse(calls[0]?.body as string).content.text as string;
    expect(new TextEncoder().encode(text).length).toBeLessThan(25_000);
    expect(text.endsWith("…(截断)")).toBe(true);
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
