import { describe, expect, test } from "bun:test";

import { createConsoleSource } from "../../src/console/source.js";
import { createLogger } from "../../src/core/logger.js";
import type { Command, Topic } from "../../src/console/types.js";

const auth = { users: { admin: "secret" }, secret: "unit-test-secret" };

function setup(extra: { commands?: Command[]; topics?: Topic[]; timeoutMs?: number } = {}) {
  const logger = createLogger({ flushIntervalMs: 0, batch: false });
  const source = createConsoleSource({
    logger,
    auth,
    timeoutMs: 20,
    ...extra,
  });
  return { logger, source };
}

describe("createConsoleSource", () => {
  test("内置命令默认就在，help 可以匿名跑", async () => {
    const { source } = setup();
    const result = await source.exec("help", null);
    expect(result.ok).toBe(true);
    expect((result as { output: { text: string } }).output.text).toContain("logs");
  });

  test("受限命令需要 token", async () => {
    const { source } = setup();
    const denied = await source.exec("top", null);
    expect(denied).toEqual({ ok: false, error: "unauthorized", unauthorized: true });

    const token = (await source.auth.login("admin", "secret")) as string;
    const allowed = await source.exec("top", token);
    expect(allowed.ok).toBe(true);
  });

  test("help 列出自定义命令", async () => {
    const { source } = setup({
      commands: [{ name: "room", note: "房间状态", public: true, run: () => ({ kind: "text", text: "" }) }],
    });
    const result = await source.exec("help", null);
    const text = (result as { output: { text: string } }).output.text;

    // 分两段：自定义在前，内置在后，一眼能分清谁给的。
    expect(text).toContain("自定义命令");
    expect(text).toContain("内置命令");
    expect(text.indexOf("room")).toBeLessThan(text.indexOf("内置命令"));
    expect(text).toContain("房间状态");
    expect(text).toContain("logs");
  });

  test("调用方命令优先于同名内置命令", async () => {
    const { source } = setup({
      commands: [{ name: "help", note: "自定义", public: true, run: () => ({ kind: "text", text: "mine" }) }],
    });
    const result = await source.exec("help", null);
    expect((result as { output: { text: string } }).output.text).toBe("mine");
  });

  test("日志实时进广播", async () => {
    const { logger, source } = setup();
    const received: unknown[] = [];
    source.broadcast.attach({ send: (_event, data) => received.push(data), close: () => {} });

    logger.info("hello");
    logger.flush();

    expect((received[0] as { msg: string }).msg).toBe("hello");
  });

  test("默认主题 top 与 mem 都在", () => {
    const { source } = setup();
    expect(source.topics.map((topic) => topic.name)).toEqual(["top", "mem"]);
  });

  test("同名主题被调用方的覆盖", () => {
    const { source } = setup({
      topics: [{ name: "top", note: "自定义", intervalMs: 5000, read: () => ({ x: 1 }) }],
    });
    const top = source.topics.filter((topic) => topic.name === "top");
    expect(top).toHaveLength(1);
    expect(top[0]?.note).toBe("自定义");
  });

  test("超时返回 timeout", async () => {
    const { source } = setup({
      commands: [{ name: "hang", note: "", public: true, run: () => new Promise<never>(() => {}) }],
    });
    expect(await source.exec("hang", null)).toEqual({ ok: false, error: "timeout" });
  });

  test("命令抛错只回 message", async () => {
    const { source } = setup({
      commands: [
        {
          name: "boom",
          note: "",
          public: true,
          run: () => {
            throw new Error("detail");
          },
        },
      ],
    });
    expect(await source.exec("boom", null)).toEqual({ ok: false, error: "Error: detail" });
  });

  test("dispose 摘掉 sink 并让后续命令失败", async () => {
    const { logger, source } = setup();
    source.dispose();

    logger.info("after");
    logger.flush();
    expect(source.broadcast.count()).toBe(0);

    expect(await source.exec("help", null)).toEqual({ ok: false, error: "console disposed" });
  });
});
