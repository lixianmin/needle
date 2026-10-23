import { describe, expect, test } from "bun:test";

import { newLogger } from "../../packages/logo/src/logo/logo.js";
import type { LogRecord } from "../../packages/logo/src/logo/types.js";

/** 收集 sink 的调用，用来断言"调了几次""每次几条"。保留原始 batch 引用。 */
function collector() {
  const calls: (readonly LogRecord[])[] = [];
  const sink = (batch: readonly LogRecord[]) => {
    calls.push(batch);
  };
  return { calls, sink };
}

const base = { flushIntervalMs: 0, batch: false } as const;

describe("newLogger", () => {
  test("记录先进缓冲，flush 后才交给 sink", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, now: () => 42, sinks: [sink] });

    logger.info("x");
    expect(calls).toHaveLength(0);

    logger.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ time: 42, level: "info", msg: "x" }]);
  });

  test("连写 1000 条只产生 1 次 sink 调用", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    for (let i = 0; i < 1000; i += 1) logger.info("n", i);
    logger.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1000);
    expect(calls[0]?.[0]?.msg).toBe("n 0");
    expect(calls[0]?.[999]?.msg).toBe("n 999");
  });

  test("warn 立即刷：积压和当前这条一次写出", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.info("a");
    logger.info("b");
    logger.warn("c");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((r) => r.msg)).toEqual(["a", "b", "c"]);
  });

  test("error 同样立即刷", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.info("a");
    logger.error("boom");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((r) => r.level)).toEqual(["info", "error"]);
  });

  test("级别过滤在入缓冲前生效", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, level: "warn", sinks: [sink] });

    logger.info("dropped");
    logger.flush();
    expect(calls).toHaveLength(0);

    logger.setLevel("debug");
    logger.debug("kept");
    logger.flush();
    expect(calls[0]?.[0]?.msg).toBe("kept");
  });

  test("多个 sink 收到同一个 batch", () => {
    const first = collector();
    const second = collector();
    const logger = newLogger({ ...base, sinks: [first.sink, second.sink] });

    logger.info("x");
    logger.flush();

    expect(first.calls[0]).toBe(second.calls[0] as LogRecord[]);
  });

  test("一个 sink 抛错不影响其他 sink", () => {
    const { calls, sink } = collector();
    const logger = newLogger({
      ...base,
      sinks: [
        () => {
          throw new Error("bad sink");
        },
        sink,
      ],
    });

    expect(() => {
      logger.info("x");
      logger.flush();
    }).not.toThrow();
    expect(calls).toHaveLength(1);
  });

  test("child 带上固定字段，父 logger 不受影响", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });
    const child = logger.child({ name: "db", traceId: "t1" });

    child.info("x");
    child.flush();
    logger.info("y");
    logger.flush();

    expect(calls[0]?.[0]).toMatchObject({ name: "db", traceId: "t1", msg: "x" });
    expect(calls[1]?.[0]?.traceId).toBeUndefined();
  });

  test("addSink / removeSink 只影响之后的批次", () => {
    const { calls, sink } = collector();
    const logger = newLogger(base);

    logger.addSink(sink);
    logger.info("x");
    logger.flush();
    expect(calls).toHaveLength(1);

    logger.removeSink(sink);
    logger.info("y");
    logger.flush();
    expect(calls).toHaveLength(1);
  });

  test("子 logger 加 sink 不影响父 logger", () => {
    const parent = collector();
    const own = collector();
    const logger = newLogger({ ...base, sinks: [parent.sink] });
    const child = logger.child({ name: "c" });

    child.addSink(own.sink);
    child.info("from-child");
    child.flush();
    logger.info("from-parent");
    logger.flush();

    // 子的新 sink 只看到子自己的记录；父的 sink 两条都看得到（子共享父的 sink）。
    expect(own.calls).toHaveLength(1);
    expect(own.calls[0]?.[0]?.msg).toBe("from-child");
    expect(parent.calls.flat().map((r) => r.msg)).toEqual(["from-child", "from-parent"]);
  });

  test("达到缓冲上限就立刻刷，不丢记录", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, maxBuffer: 3, sinks: [sink] });

    for (let i = 0; i < 10; i += 1) logger.info("n", i);

    const written = calls.flat().map((r) => r.msg);
    expect(written).toEqual(["n 0", "n 1", "n 2", "n 3", "n 4", "n 5", "n 6", "n 7", "n 8"]);
    logger.flush();
    expect(calls.flat()).toHaveLength(10);
  });

  test("栈：warn 带调用点，info 不带", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.info("i");
    logger.warn("w");
    logger.flush();

    const [infoRecord, warnRecord] = calls.flat();
    expect(infoRecord?.stack).toBeUndefined();
    expect(warnRecord?.stack).toContain("logger.test.ts");
    expect(warnRecord?.stack).not.toContain("core/logo.ts");
  });

  test("stackLevel 可关闭", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, stackLevel: "off", sinks: [sink] });

    logger.error("e");
    expect(calls[0]?.[0]?.stack).toBeUndefined();
  });

  test("dispose 把剩余记录写出去", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.info("last");
    logger.dispose();

    expect(calls[0]?.[0]?.msg).toBe("last");
    expect(() => logger.info("after")).not.toThrow();
  });
});
