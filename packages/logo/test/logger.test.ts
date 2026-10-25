import { describe, expect, test } from "bun:test";

import { newLogger } from "../src/logo.js";
import type { LogRecord } from "../src/types.js";

/** 收集 sink 的调用，用来断言"调了几次""每次几条"。保留原始 batch 引用。 */
function collector() {
  const calls: (readonly LogRecord[])[] = [];
  const sink = (batch: readonly LogRecord[]) => {
    calls.push(batch);
  };
  return { calls, sink };
}

// batch:true + flushIntervalMs:0 = 只手动 flush，不装定时器；其余用例靠它测缓冲语义。
const base = { flushIntervalMs: 0, batch: true } as const;

describe("newLogger", () => {
  test("记录先进缓冲，flush 后才交给 sink", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, now: () => 42, sinks: [sink] });

    logger.info("x");
    expect(calls).toHaveLength(0);

    logger.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject([{ time: 42, level: "info", msg: "x" }]);
  });

  test("连写 1000 条只产生 1 次 sink 调用", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    for (let i = 0; i < 1000; i += 1) {
      logger.info("n", i);
    }

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

    for (let i = 0; i < 10; i += 1) {
      logger.info("n", i);
    }

    const written = calls.flat().map((r) => r.msg);
    expect(written).toEqual(["n 0", "n 1", "n 2", "n 3", "n 4", "n 5", "n 6", "n 7", "n 8"]);
    logger.flush();
    expect(calls.flat()).toHaveLength(10);
  });

  // 调用点不再逐条抓：打包后栈里全是 bundle 坐标，付了代价拿不到结果。
  // 只有 error 级保留完整栈——那是唯一还必须留在记录里的栈信息。
  test("info / warn 不再抓调用点，error 仍带完整栈", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.info("i");
    logger.warn("w");
    logger.error(new Error("boom"));
    logger.flush();

    const records = calls.flat();
    const info = records.find((entry) => entry.level === "info");
    const warn = records.find((entry) => entry.level === "warn");
    const error = records.find((entry) => entry.level === "error");
    expect(info?.site).toBeUndefined();
    expect(info?.fn).toBeUndefined();
    expect(info?.stack).toBeUndefined();
    expect(warn?.site).toBeUndefined();
    expect(error?.stack).toContain("Error: boom");
  });

  test("完整栈：默认只有 error 带，info / warn 不带", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.flush();

    const records = calls.flat();
    const find = (msg: string) => records.find((record) => record.msg === msg);
    expect(find("i")?.stack).toBeUndefined();
    expect(find("w")?.stack).toBeUndefined();
    expect(find("e")?.stack).toContain("logger.test.ts");
    // 内部帧按「与 logger 同目录」剪掉：断言不含实现文件，不依赖包的目录名。
    expect(find("e")?.stack).not.toContain("logo.ts");
    // 剪完内部帧，第一条就是调用点本身。
    expect(find("e")?.stack?.split("\n")[1]).toContain("logger.test.ts");
  });

  test("stackLevel 可显式设成 warn", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, stackLevel: "warn", sinks: [sink] });

    logger.warn("w");
    logger.flush();

    expect(calls.flat()[0]?.stack).toContain("logger.test.ts");
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

describe("batch:false", () => {
  // 关掉批量就没有定时器兜底，必须每条立刻写出；否则 info 会永远留在缓冲里，
  // 只有 warn / error 能把它们顺带冲出去。Workers 上默认就是这条路径。
  test("每条记录立刻写出，不等定时器", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, batch: false, sinks: [sink] });

    logger.info("a");
    logger.info("b");

    expect(calls.map((batch) => batch.map((record) => record.msg))).toEqual([["a"], ["b"]]);
    logger.dispose();
  });
});

describe("child 的固定字段", () => {
  // 记录会被 sink 直接序列化（IDB 走 structuredClone），所以 child({ cb: () => {} })
  // 这种入口也必须脱敏，否则该 child 的每一条日志都写不进去。
  test("固定字段与本次调用的字段走同一套 sanitize", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });
    const child = logger.child({ cb: () => {}, when: new Date(0) });

    child.info("x");
    child.flush();

    expect(calls[0]?.[0]?.cb).toBe("[Function]");
    expect(calls[0]?.[0]?.when).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("dispose 与 child", () => {
  // 计划里 child 的定义是「共享父的 buffer 与 sinks 快照」，实现曾经只共享 disposed，
  // 于是子缓冲既不会被父 flush 带走，子定时器也不会被父 dispose 清掉。
  test("父 dispose 冲掉子 logger 已缓冲的记录", () => {
    const { calls, sink } = collector();
    const parent = newLogger({ ...base, sinks: [sink] });
    const child = parent.child({ name: "db" });

    child.info("buffered-in-child");
    parent.dispose();

    expect(calls.flat().map((record) => record.msg)).toEqual(["buffered-in-child"]);
  });

  test("父 dispose 之后，子 logger 排定的定时器不再产生新的写出", async () => {
    const { calls, sink } = collector();
    const parent = newLogger({ batch: true, flushIntervalMs: 20, sinks: [sink] });
    const child = parent.child({ name: "db" });

    child.info("x");
    parent.dispose();
    // dispose 本身会把积压冲出去（一次，正常）；记下这次之后的调用数。
    const afterDispose = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 定时器若没被 dispose 清掉，会在 20ms 后把子缓冲再写一遍。
    expect(calls.length).toBe(afterDispose);
  });

  test("父 logger dispose 后，子 logger 也停止写入", () => {
    const { calls, sink } = collector();
    const parent = newLogger({ ...base, sinks: [sink] });
    const child = parent.child({ name: "db" });

    parent.dispose();
    const afterDispose = calls.length;
    child.info("after");

    expect(calls.length).toBe(afterDispose);
  });
});
