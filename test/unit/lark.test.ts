import { describe, expect, test } from "bun:test";

import { createLarkSink } from "../../src/core/logo/sinks/lark.js";
import type { LogRecord } from "../../src/core/logo/types.js";

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
    expect(text.length).toBeLessThan(19_000);
    expect(text.endsWith("…(截断)")).toBe(true);
  });
});
