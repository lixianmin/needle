import { describe, expect, test } from "bun:test";

import { createConsoleSource } from "../../src/console/source.js";
import { createLocalAdapter } from "../../src/console/ui/local.js";
import type { ConsoleEvent } from "../../src/console/ui/adapter.js";
import { newLogger } from "../../src/core/logo/logo.js";
import { TEST_VERSION } from "../fixtures.js";

function setup() {
  const logger = newLogger({ flushIntervalMs: 0, batch: false });
  const source = createConsoleSource({
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
    const events: ConsoleEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    expect(events[0]?.type).toBe("handshake");
    const hello = events[0] as Extract<ConsoleEvent, { type: "handshake" }>;
    expect(hello.info.user).toBe("local-dev");
    expect(hello.info.commands.map((command) => command.name)).toContain("log.list");
  });

  test("本地身份跳过鉴权，受限命令可直接执行", async () => {
    const { adapter } = setup();
    const result = await adapter.exec("top");
    expect(result.ok).toBe(true);
  });

  test("日志不会自动流进控制台", () => {
    const { logger, adapter } = setup();
    const events: ConsoleEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    logger.info("hi");
    logger.flush();

    // 控制台只收命令结果与订阅主题；日志量一大就会把页面淹掉，不自动推。
    expect(events.map((event) => event.type)).toEqual(["handshake"]);
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
