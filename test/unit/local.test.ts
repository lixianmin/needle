import { describe, expect, test } from "bun:test";

import { createConsoleSource } from "../../src/console/source.js";
import { createLocalAdapter } from "../../src/console/ui/local.js";
import type { ConsoleEvent } from "../../src/console/ui/adapter.js";
import { createLogger } from "../../src/core/logger.js";

function setup() {
  const logger = createLogger({ flushIntervalMs: 0, batch: false });
  const source = createConsoleSource({
    logger,
    auth: { users: {} },
    user: "local-dev",
    version: "0.1.0",
  });
  return { logger, source, adapter: createLocalAdapter(source) };
}

describe("createLocalAdapter", () => {
  test("订阅立刻收到 hello，带本地身份与命令表", () => {
    const { adapter } = setup();
    const events: ConsoleEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    expect(events[0]?.type).toBe("hello");
    const hello = events[0] as Extract<ConsoleEvent, { type: "hello" }>;
    expect(hello.info.user).toBe("local-dev");
    expect(hello.info.commands.map((command) => command.name)).toContain("logs");
  });

  test("本地身份跳过鉴权，受限命令可直接执行", async () => {
    const { adapter } = setup();
    const result = await adapter.exec("ps");
    expect(result.ok).toBe(true);
  });

  test("日志通过 broadcast 流到订阅者", () => {
    const { logger, adapter } = setup();
    const events: ConsoleEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    logger.info("hi");
    logger.flush();

    const logs = events.filter((event) => event.type === "log");
    expect(logs).toHaveLength(1);
    expect((logs[0] as Extract<ConsoleEvent, { type: "log" }>).record.msg).toBe("hi");
  });

  test("退订后不再收到事件", () => {
    const { logger, adapter } = setup();
    const events: ConsoleEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));
    unsubscribe();
    events.length = 0;

    logger.info("after");
    logger.flush();
    expect(events).toHaveLength(0);
  });
});
