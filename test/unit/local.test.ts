import { describe, expect, test } from "bun:test";

import { createShellSource } from "../../packages/shell/src/source.js";
import { createLocalAdapter } from "../../packages/shell/src/ui/local.js";
import type { ShellEvent } from "../../packages/shell/src/ui/adapter.js";
import { newLogger } from "../../packages/logo/src/logo/logo.js";
import { TEST_VERSION } from "../fixtures.js";

function setup() {
  const logger = newLogger({ flushIntervalMs: 0, batch: false });
  const source = createShellSource({
    logger,
    auth: { users: {} },
    user: "local-dev",
    version: TEST_VERSION,
  });
  return { logger, source, adapter: createLocalAdapter(source) };
}

describe("createLocalAdapter", () => {
  test("订阅立刻收到 hello，带本地身份与命令表", () => {
    const { adapter } = setup();
    const events: ShellEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    expect(events[0]?.type).toBe("handshake");
    const hello = events[0] as Extract<ShellEvent, { type: "handshake" }>;
    expect(hello.info.user).toBe("local-dev");
    expect(hello.info.commands.map((command) => command.name)).toContain("log.list");
  });

  test("本地身份跳过鉴权，受限命令可直接执行", async () => {
    const { adapter } = setup();
    const result = await adapter.exec("top");
    expect(result.ok).toBe(true);
  });

  test("日志成批流到日志栏（不进命令输出区）", () => {
    const { logger, adapter } = setup();
    const events: ShellEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    logger.info("hi");
    logger.flush();

    const logs = events.filter((event) => event.type === "logs");
    expect(logs).toHaveLength(1);
    expect((logs[0] as Extract<ShellEvent, { type: "logs" }>).records[0]?.msg).toBe("hi");
  });

  test("退订后不再收到事件", () => {
    const { logger, adapter } = setup();
    const events: ShellEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));
    unsubscribe();
    events.length = 0;

    logger.info("after");
    logger.flush();
    expect(events).toHaveLength(0);
  });
});
