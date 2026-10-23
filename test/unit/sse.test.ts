import { describe, expect, test } from "bun:test";

import {
  createBroadcast,
  createSseResponse,
  parseTopicSpecs,
} from "../../packages/shell/src/sse.js";
import type { Command, Topic } from "../../packages/shell/src/types.js";
import type { LogRecord } from "../../packages/logo/src/index.js";
import { TEST_VERSION } from "../fixtures.js";

const record = (msg: string): LogRecord => ({ time: 1, level: "info", msg });

const commands: Command[] = [
  { name: "help", note: "列出命令", run: () => ({ kind: "text", text: "" }) },
];

const topics: Topic[] = [
  { name: "top", note: "cpu", intervalMs: 1000, read: () => ({ cpu: 1 }) },
  { name: "mem", note: "内存", intervalMs: 5000, read: () => ({ rss: 2 }) },
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readFor(response: Response, ms: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";

  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      delay(deadline - Date.now()).then(() => null),
    ]);
    if (chunk === null) break; // 超时
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }

  await reader.cancel();
  return text;
}

describe("createBroadcast", () => {
  test("detach 之后计数归零", () => {
    const broadcast = createBroadcast();
    const detach = broadcast.attach({ send: () => {}, close: () => {} });

    expect(broadcast.count()).toBe(1);
    detach();
    expect(broadcast.count()).toBe(0);
  });

  test("closeAll 关闭所有连接", () => {
    const broadcast = createBroadcast();
    const closed: number[] = [];
    broadcast.attach({ send: () => {}, close: () => closed.push(1) });
    broadcast.attach({ send: () => {}, close: () => closed.push(2) });

    broadcast.closeAll();

    expect(closed).toHaveLength(2);
    expect(broadcast.count()).toBe(0);
  });
});

describe("parseTopicSpecs", () => {
  test("解析名字与间隔，并钳到合法区间", () => {
    const specs = parseTopicSpecs("top:99999,mem:1", topics);
    expect(specs.map((spec) => spec.topic.name)).toEqual(["top", "mem"]);
    expect(specs[0]?.intervalMs).toBe(60_000);
    expect(specs[1]?.intervalMs).toBe(1000);
  });

  test("不带间隔时用默认值", () => {
    expect(parseTopicSpecs("mem", topics)[0]?.intervalMs).toBe(5000);
  });

  test("未知名字被忽略，空串返回空数组", () => {
    expect(parseTopicSpecs("nope", topics)).toEqual([]);
    expect(parseTopicSpecs("", topics)).toEqual([]);
    expect(parseTopicSpecs(null, topics)).toEqual([]);
  });
});

describe("createSseResponse", () => {
  test("第一帧是 hello，带命令与用户", async () => {
    const response = createSseResponse({
      user: "admin",
      title: "node",
      version: TEST_VERSION,
      commands,
      topics,
      broadcast: createBroadcast(),
      heartbeatMs: 60_000,
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await readFor(response, 100);
    expect(text.startsWith("event: handshake")).toBe(true);
    expect(text).toContain('"user":"admin"');
    expect(text).toContain('"name":"help"');
  });

  test("日志帧按批推到流里", async () => {
    const broadcast = createBroadcast();
    const response = createSseResponse({
      user: "admin",
      title: "node",
      version: TEST_VERSION,
      commands,
      topics: [],
      broadcast,
      heartbeatMs: 60_000,
    });

    broadcast.sink([record("live")]);
    const text = await readFor(response, 100);

    expect(text.startsWith("event: handshake")).toBe(true);
    expect(text).toContain("event: log");
    expect(text).toContain('"msg":"live"');
  });

  test("订阅的主题按间隔推送", async () => {
    const response = createSseResponse({
      user: "admin",
      title: "node",
      version: TEST_VERSION,
      commands,
      topics,
      topicSpec: "top:1000",
      broadcast: createBroadcast(),
      heartbeatMs: 60_000,
    });

    const text = await readFor(response, 1200);
    expect(text).toContain("event: topic");
    expect(text).toContain('"name":"top"');
  });

  test("取消读端后连接从 broadcast 摘除", async () => {
    const broadcast = createBroadcast();
    const response = createSseResponse({
      user: "admin",
      title: "node",
      version: TEST_VERSION,
      commands,
      topics,
      broadcast,
      heartbeatMs: 60_000,
    });

    const reader = response.body?.getReader();
    await reader?.read();
    expect(broadcast.count()).toBe(1);

    await reader?.cancel();
    expect(broadcast.count()).toBe(0);
  });

  test("心跳是注释帧", async () => {
    const response = createSseResponse({
      user: "admin",
      title: "node",
      version: TEST_VERSION,
      commands,
      topics: [],
      broadcast: createBroadcast(),
      heartbeatMs: 20,
    });

    const text = await readFor(response, 200);
    const pings = text.split("\n").filter((line) => line.startsWith(":"));
    expect(pings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("广播日志帧", () => {
  test("一批日志按 200 条切帧，级别不在这里过滤", () => {
    const broadcast = createBroadcast();
    const received: Array<{ event: string; data: unknown }> = [];
    broadcast.attach({ send: (event, data) => received.push({ event, data }), close: () => {} });

    // debug 也转发：日志级别由 logger 自己决定，控制台不再二次过滤。
    broadcast.sink(Array.from({ length: 450 }, (_, index) => ({ time: 1, level: "debug" as const, msg: `d${index}` })));
    expect(received.map((item) => item.event)).toEqual(["log", "log", "log"]);
    expect((received[0]?.data as unknown[]).length).toBe(200);
    expect((received[2]?.data as unknown[]).length).toBe(50);
  });
});

describe("订阅参数", () => {
  const many: Topic[] = Array.from({ length: 20 }, (_, index) => ({
    name: `t${index}`,
    note: "",
    intervalMs: 1000,
    read: async () => ({}),
  }));

  test("同名主题只保留一个", () => {
    const specs = parseTopicSpecs("t1:1000,t1:2000,t2", many);
    expect(specs.map((spec) => spec.topic.name)).toEqual(["t1", "t2"]);
  });

  test("一条 URL 最多订 16 个主题", () => {
    const specs = parseTopicSpecs(many.map((topic) => topic.name).join(","), many);
    expect(specs).toHaveLength(16);
  });
});

describe("多连接共用编码", () => {
  test("同一帧只序列化一次（sendText），没有 sendText 的连接走回退", () => {
    const broadcast = createBroadcast();
    const texts: string[] = [];
    const fallback: unknown[] = [];

    broadcast.attach({ send: () => {}, sendText: (text) => texts.push(text), close: () => {} });
    broadcast.attach({ send: () => {}, sendText: (text) => texts.push(text), close: () => {} });
    broadcast.attach({ send: (_event, data) => fallback.push(data), close: () => {} });

    broadcast.sink([record("a"), record("b")]);

    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).toContain("event: log");
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toEqual([record("a"), record("b")]);
  });
});
