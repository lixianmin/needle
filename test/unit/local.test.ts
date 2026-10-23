import { describe, expect, test } from "bun:test";

import { createShellSource } from "../../src/shell/source.js";
import { createLocalAdapter } from "../../src/shell/ui/local.js";
import type { ShellEvent } from "../../src/shell/ui/adapter.js";
import { newLogger } from "../../src/logo/logo.js";
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
    const events:ShellEvent[] = [];
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
    const events:ShellEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    logger.info("hi");
    logger.flush();

    const logs = events.filter((event) => event.type === "logs");
    expect(logs).toHaveLength(1);
    expect((logs[0] as Extract<ShellEvent, { type: "logs" }>).records[0]?.msg).toBe("hi");
  });

  test("退订后不再收到事件", () => {
    const { logger, adapter } = setup();
    const events:ShellEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));
    unsubscribe();
    events.length = 0;

    logger.info("after");
    logger.flush();
    expect(events).toHaveLength(0);
  });
});

describe("卸载", () => {
  test("最后一个订阅退掉后，主题定时器与广播连接一起停", async () => {
    let reads = 0;
    const withTopic = createShellSource({
      logger: newLogger({ flushIntervalMs: 0, batch: false }),
      auth: { users: {} },
      user: "local-dev",
      topics: [
        {
          name: "tick",
          note: "",
          intervalMs: 10,
          read: async () => {
            reads += 1;
            return {};
          },
        },
      ],
    });
    const local = createLocalAdapter(withTopic);
    const unsubscribe = local.subscribe(() => {});
    local.setTopics("tick");

    await new Promise((resolve) => setTimeout(resolve, 40));
    const before = reads;
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reads).toBe(before);
    expect(withTopic.broadcast.count()).toBe(0);
  });
});

describe("fetchFile 读取本机日志", () => {
  function setupWithLogFiles(reads: Map<string, string | null>) {
    const logger = newLogger({ flushIntervalMs: 0, batch: false });
    const source = createShellSource({
      logger,
      auth: { users: {} },
      user: "local-dev",
      logFiles: {
        list: async () => [],
        read: async (name: string) => reads.get(name) ?? null,
      },
    });
    return createLocalAdapter(source);
  }

  test("/log/:name 直读 logFiles", async () => {
    const adapter = setupWithLogFiles(new Map([["info.log", "行1\n行2"]]));
    const result = await adapter.fetchFile("/log/info.log");
    expect(result).toEqual({ ok: true, text: "行1\n行2" });
  });

  test("文件不存在返回 ok:false", async () => {
    const adapter = setupWithLogFiles(new Map());
    const result = await adapter.fetchFile("/log/ghost.log");
    expect(result.ok).toBe(false);
  });

  test("未配置 logFiles 时提示未配置", async () => {
    const { adapter } = setup();
    const result = await adapter.fetchFile("/log/info.log");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain("未配置");
    }
  });

  test("非 /log/ 的 href 维持失败", async () => {
    const adapter = setupWithLogFiles(new Map([["info.log", "x"]]));
    const result = await adapter.fetchFile("/other/stuff");
    expect(result.ok).toBe(false);
  });

  test("文件名带编码字符与 query 正确解析", async () => {
    const adapter = setupWithLogFiles(new Map([["a b.log", "内容"]]));
    const result = await adapter.fetchFile("/log/a%20b.log?x=1");
    expect(result).toEqual({ ok: true, text: "内容" });
  });
});
