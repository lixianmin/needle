import { describe, expect, test } from "bun:test";

import { createShellSource } from "../src/source.js";
// 必须跟 shell 内部用的是同一个模块实例：两边都按包名解析到 @needle/logo 的 dist。
import { logo, newLogger } from "@needle/logo";
import type { Command, Topic } from "../src/types.js";

const auth = { users: { admin: "secret" }, secret: "unit-test-secret" };

function setup(extra: { commands?: Command[]; topics?: Topic[]; timeoutMs?: number } = {}) {
  const logger = newLogger({ flushIntervalMs: 0, batch: false });
  const source = createShellSource({
    logger,
    auth,
    timeoutMs: 20,
    ...extra,
  });
  return { logger, source };
}

describe("createShellSource", () => {
  test("内置命令默认就在，help 匿名也能跑（只列 auth/help）", async () => {
    const { source } = setup();
    const result = await source.exec("help", null);
    expect(result.ok).toBe(true);

    const text = (result as { output: { text: string } }).output.text;
    expect(text).toContain("auth");
    expect(text).not.toContain("log.list");
  });

  test("受限命令需要 token", async () => {
    const { source } = setup();
    const denied = await source.exec("top", null);
    expect(denied).toEqual({ ok: false, code: "unauthorized", error: "unauthorized" });

    const token = (await source.auth.login("admin", "secret")) as string;
    const allowed = await source.exec("top", token);
    expect(allowed.ok).toBe(true);
  });

  test("help 列出自定义命令", async () => {
    const { source } = setup({
      commands: [{ name: "room", note: "房间状态", run: () => ({ kind: "text", text: "" }) }],
    });
    const token = (await source.auth.login("admin", "secret")) as string;
    const result = await source.exec("help", token);
    const text = (result as { output: { text: string } }).output.text;

    // 分两段：自定义在前，内置在后，一眼能分清谁给的。
    expect(text).toContain("自定义命令");
    expect(text).toContain("内置命令");
    expect(text.indexOf("room")).toBeLessThan(text.indexOf("内置命令"));
    // help 是库提供的，应该出现在内置组里
    expect(text.indexOf("内置命令")).toBeLessThan(text.indexOf("help"));
    // help 也是库给的，应该出现在内置组里
    expect(text.indexOf("help")).toBeGreaterThan(text.indexOf("内置命令"));
    expect(text).toContain("房间状态");
    expect(text).toContain("log.list");
  });

  test("调用方命令优先于同名内置命令", async () => {
    const { source } = setup({
      commands: [{ name: "help", note: "自定义", run: () => ({ kind: "text", text: "mine" }) }],
    });
    const result = await source.exec("help", null);
    expect((result as { output: { text: string } }).output.text).toBe("mine");
  });

  test("日志进广播：按批推给页面", async () => {
    const { logger, source } = setup();
    const received: unknown[] = [];
    source.broadcast.attach({ send: (_event, data) => received.push(data), close: () => {} });

    logger.info("hello");
    logger.flush();

    expect(received).toHaveLength(1);
    expect((received[0] as Array<{ msg: string }>)[0]?.msg).toBe("hello");
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
      commands: [{ name: "hang", note: "", run: () => new Promise<never>(() => {}) }],
    });
    const token = (await source.auth.login("admin", "secret")) as string;
    expect(await source.exec("hang", token)).toEqual({ ok: false, code: "timeout", error: "timeout" });
  });

  test("命令抛错只回 message", async () => {
    const { source } = setup({
      commands: [
        {
          name: "boom",
          note: "",
          run: () => {
            throw new Error("detail");
          },
        },
      ],
    });
    const token = (await source.auth.login("admin", "secret")) as string;
    expect(await source.exec("boom", token)).toEqual({
      ok: false,
      code: "command_failed",
      error: "Error: detail",
    });
  });

  test("dispose 摘掉 sink 并让后续命令失败", async () => {
    const { logger, source } = setup();
    source.dispose();

    logger.info("after");
    logger.flush();
    expect(source.broadcast.count()).toBe(0);

    expect(await source.exec("help", null)).toEqual({
      ok: false,
      code: "disposed",
      error: "shell disposed",
    });
  });
});

describe("日志来源", () => {
  test("不传 logger 时接管全局 logo", () => {
    const source = createShellSource({ auth });
    const received: Array<Array<{ msg?: string }>> = [];
    source.broadcast.attach({
      send: (_event, data) => received.push(data as Array<{ msg?: string }>),
      close: () => {},
    });

    logo.info("global-line");
    logo.flush();

    expect(received.flat().some((record) => record.msg === "global-line")).toBe(true);
    source.dispose();
  });
});

describe("未登录", () => {
  test("help 只列 auth 与 help", async () => {
    const { source } = setup();
    const result = await source.exec("help", null);
    const text = (result as { output: { text: string } }).output.text;

    expect(text).toContain("auth");
    expect(text).toContain("help");
    expect(text).not.toContain("log.list");
    expect(text).not.toContain("top");
    expect(text).not.toContain("sub");
  });

  test("自定义命令与受限命令都返回 unauthorized", async () => {
    const { source } = setup({
      commands: [{ name: "room", note: "房间状态", run: () => ({ kind: "text", text: "" }) }],
    });

    expect(await source.exec("room", null)).toEqual({ ok: false, code: "unauthorized", error: "unauthorized" });
    expect(await source.exec("top", null)).toEqual({ ok: false, code: "unauthorized", error: "unauthorized" });
  });
});
