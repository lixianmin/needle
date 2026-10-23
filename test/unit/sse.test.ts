import { describe, expect, test } from "bun:test";

import {
  createBroadcast,
  createSseResponse,
  parseTopicSpecs,
} from "../../src/shell/sse.js";
import type { Command, Topic } from "../../src/shell/types.js";
import { TEST_VERSION } from "../fixtures.js";

const commands: Command[] = [
  { name: "help", note: "列出命令", public: true, run: () => ({ kind: "text", text: "" }) },
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

  test("控制台不再把日志推到流里", async () => {
    const response = createSseResponse({
      user: "admin",
      title: "node",
      version: TEST_VERSION,
      commands,
      topics: [],
      broadcast: createBroadcast(),
      heartbeatMs: 60_000,
    });

    const text = await readFor(response, 100);

    expect(text.startsWith("event: handshake")).toBe(true);
    expect(text).not.toContain("event: log");
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
