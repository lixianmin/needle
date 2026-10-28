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

/** 抓住 console.error，用来断言「坏 sink 只提示一次」这类行为。 */
async function withConsoleError<T>(
  run: (seen: unknown[], messages: unknown[]) => T,
): Promise<T> {
  const seen: unknown[] = [];
  const messages: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    seen.push(args[0]);
    messages.push(args[1]);
  };
  try {
    return await run(seen, messages);
  } finally {
    console.error = original;
  }
}

describe("stackLevel 关闭时 error 也不带栈", () => {
  // 关闭采集是「连 error 都不要栈」，与「info 不带栈」是两条不同的路径。
  test('stackLevel: "off" 时用字符串参数打 error，记录里没有 stack', () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, stackLevel: "off", sinks: [sink] });

    logger.error("boom");

    expect("stack" in (calls.flat()[0] ?? {})).toBe(false);
  });

  test("默认 stackLevel 下字符串参数也带栈（否则等于悄悄关了）", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.error("boom");

    expect(calls.flat()[0]?.stack).toContain("logger.test.ts");
  });
});

describe("栈裁剪", () => {
  // 栈里出现库自己就等于没裁剪：排障时第一眼看的是调用方，不是我们的内部帧。
  // 裁剪靠「拿本文件所在目录当基准」实现，写死路径或正则写错都会让内部帧漏出来。
  test("error 的栈剪掉库内部帧，头行仍是 Error，调用方还在", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.error("boom");

    const stack = calls.flat()[0]?.stack ?? "";
    expect(stack.startsWith("Error\n")).toBe(true);
    expect(stack).toContain("logger.test.ts");
    expect(stack).not.toContain("logo/src/");
  });
});

describe("坏 sink 的报错", () => {
  test("只提示一次：同一条坏 sink 每批都抛，也不该刷屏", async () => {
    await withConsoleError((seen, messages) => {
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

      logger.info("a");
      logger.flush();
      logger.info("b");
      logger.flush();

      expect(seen).toHaveLength(1);
      // 提示得能定位：前缀说明是哪个库，第二个参数带出原因
      expect(String(seen[0])).toContain("[logo]");
      expect(String(messages[0])).toContain("bad sink");
      expect(calls).toHaveLength(2);
    });
  });

  test("没人抛错时一次都不提示（否则真出错时看不出来）", async () => {
    await withConsoleError((seen) => {
      const { calls, sink } = collector();
      const logger = newLogger({ ...base, sinks: [sink] });

      logger.info("x");
      logger.flush();

      expect(calls).toHaveLength(1);
      expect(seen).toHaveLength(0);
    });
  });
});

describe("定时器", () => {
  test("到点自动写出", async () => {
    const { calls, sink } = collector();
    const logger = newLogger({ batch: true, flushIntervalMs: 10, sinks: [sink] });

    logger.info("x");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.flat().map((record) => record.msg)).toEqual(["x"]);
    logger.dispose();
  });

  test("手动 flush 会取消已排的定时器，不会写两遍", async () => {
    const { calls, sink } = collector();
    const logger = newLogger({ batch: true, flushIntervalMs: 10, sinks: [sink] });

    logger.info("x");
    logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls).toHaveLength(1);
    logger.dispose();
  });

  test("flushIntervalMs 为 0 时不装定时器，只能手动 flush", async () => {
    const { calls, sink } = collector();
    const logger = newLogger({ batch: true, flushIntervalMs: 0, sinks: [sink] });

    logger.info("x");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);

    logger.flush();
    expect(calls).toHaveLength(1);
    logger.dispose();
  });

  test("batch:false 时也不装定时器", async () => {
    const { calls, sink } = collector();
    const logger = newLogger({ batch: false, flushIntervalMs: 10, sinks: [sink] });

    logger.info("x");
    await new Promise((resolve) => setTimeout(resolve, 30));

    // 每条已经立刻写过了，定时器不该再补一次空批
    expect(calls).toHaveLength(1);
    logger.dispose();
  });

  test("排定时器时调 unref：一批没到期的日志不该让进程挂着", () => {
    const { sink } = collector();
    const original = globalThis.setTimeout;
    let unrefs = 0;
    globalThis.setTimeout = (() => ({
      unref: () => {
        unrefs += 1;
      },
    })) as unknown as typeof setTimeout;

    try {
      const logger = newLogger({ batch: true, flushIntervalMs: 10, sinks: [sink] });
      logger.info("x");
      expect(unrefs).toBe(1);
      logger.dispose();
    } finally {
      globalThis.setTimeout = original;
    }
  });
});

describe("dispose 清理", () => {
  test("逐个关闭带 close 的 sink，this 指向 sink 本身", () => {
    const closed: unknown[] = [];
    const sink = Object.assign(() => {}, {
      close(this: unknown) {
        closed.push(this);
      },
    });
    const logger = newLogger({ ...base, sinks: [sink as never] });

    logger.dispose();

    expect(closed).toEqual([sink]);
  });

  test("一个 sink 的 close 抛错不影响后续 sink，异常也不会漏出去", async () => {
    await withConsoleError((seen) => {
      const closed: string[] = [];
      const bad = Object.assign(() => {}, {
        close() {
          throw new Error("close 炸了");
        },
      });
      const good = Object.assign(() => {}, {
        close() {
          closed.push("good");
        },
      });
      const logger = newLogger({ ...base, sinks: [bad as never, good as never] });

      expect(() => logger.dispose()).not.toThrow();
      expect(closed).toEqual(["good"]);
      expect(seen).toHaveLength(1);
    });
  });

  test("dispose 之后不再进缓冲（连 sink 都不会被叫）", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.dispose();
    logger.info("after");

    expect(calls).toHaveLength(0);
  });
});

describe("其它边界", () => {
  test("removeSink 摘一个不在列表里的 sink 是空操作", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.removeSink(() => {});
    logger.info("x");
    logger.flush();

    expect(calls).toHaveLength(1);
  });

  test("child 的 name：显式给的优先，没给就继承父的", () => {
    const { calls, sink } = collector();
    const parent = newLogger({ ...base, name: "parent", sinks: [sink] });

    parent.child({ a: 1 }).info("no-name");
    parent.child({ name: "child" }).info("with-name");
    parent.flush();

    expect(calls.flat().map((record) => [record.msg, record.name])).toEqual([
      ["no-name", "parent"],
      ["with-name", "child"],
    ]);
  });
});

describe("缓冲与定时器的边界（用假的 setTimeout 观测有没有装定时器）", () => {
  /** 把 setTimeout / clearTimeout 换成可观测的假实现：只记账，不真触发。 */
  async function withFakeTimers<T>(
    run: (seen: { scheduled: number; cleared: number }) => T,
  ): Promise<T> {
    const originalSet = globalThis.setTimeout;
    const originalClear = globalThis.clearTimeout;
    const seen = { scheduled: 0, cleared: 0 };
    globalThis.setTimeout = (() => {
      seen.scheduled += 1;
      return { unref: () => {} } as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => {
      seen.cleared += 1;
    }) as unknown as typeof clearTimeout;
    try {
      return await run(seen);
    } finally {
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    }
  }

  test("flush 会取消已排的定时器", async () => {
    await withFakeTimers((seen) => {
      const { sink } = collector();
      const logger = newLogger({ batch: true, flushIntervalMs: 10, sinks: [sink] });

      logger.info("x");
      expect(seen.scheduled).toBe(1);
      logger.flush();
      expect(seen.cleared).toBe(1);
      logger.dispose();
    });
  });

  test("已经有排着的定时器时不再重复排（一批日志只一个定时器）", async () => {
    await withFakeTimers((seen) => {
      const { sink } = collector();
      const logger = newLogger({ batch: true, flushIntervalMs: 10, sinks: [sink] });

      logger.info("a");
      logger.info("b");
      logger.info("c");
      expect(seen.scheduled).toBe(1);
      logger.dispose();
    });
  });

  test("flushIntervalMs 为 0 时根本不排定时器", async () => {
    await withFakeTimers((seen) => {
      const { sink } = collector();
      const logger = newLogger({ batch: true, flushIntervalMs: 0, sinks: [sink] });

      logger.info("x");
      expect(seen.scheduled).toBe(0);
      logger.dispose();
    });
  });

  test("dispose 会取消已排的定时器", async () => {
    await withFakeTimers((seen) => {
      const { sink } = collector();
      const logger = newLogger({ batch: true, flushIntervalMs: 10, sinks: [sink] });

      logger.info("x");
      logger.dispose();
      expect(seen.cleared).toBe(1);
    });
  });

  test("运行时不支持 unref 也不炸（Workers 的 setTimeout 返回值是数字）", async () => {
    const originalSet = globalThis.setTimeout;
    globalThis.setTimeout = (() => 1) as unknown as typeof setTimeout;
    try {
      const { sink } = collector();
      const logger = newLogger({ batch: true, flushIntervalMs: 10, sinks: [sink] });

      expect(() => logger.info("x")).not.toThrow();
      logger.dispose();
    } finally {
      globalThis.setTimeout = originalSet;
    }
  });

  test("不传 batch 时按 hasStdout() 决定：本进程有 stdout，因此攒批", () => {
    const { calls, sink } = collector();
    // 只给 flushIntervalMs: 0（不装定时器），batch 走默认值
    const logger = newLogger({ flushIntervalMs: 0, sinks: [sink] });

    logger.info("a");
    logger.info("b");
    expect(calls).toHaveLength(0);   // 攒着，没有「每条立刻写出」

    logger.flush();
    expect(calls.flat().map((record) => record.msg)).toEqual(["a", "b"]);
    logger.dispose();
  });

  test("一个 sink 都没有时照常工作（默认空数组没有被塞进假元素）", async () => {
    await withConsoleError((seen) => {
      const logger = newLogger({ ...base });

      expect(() => {
        logger.info("x");
        logger.flush();
      }).not.toThrow();
      expect(seen).toHaveLength(0);
      logger.dispose();
    });
  });

  test("flush 之后缓冲清空：下一批只有新记录", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.info("a");
    logger.flush();
    logger.info("b");
    logger.flush();

    expect(calls.map((batch) => batch.map((record) => record.msg))).toEqual([["a"], ["b"]]);
  });

  test("dispose 之后即使手动 flush 也不会再写出", () => {
    const { calls, sink } = collector();
    const logger = newLogger({ ...base, sinks: [sink] });

    logger.dispose();
    logger.info("after");
    logger.flush();

    expect(calls).toHaveLength(0);
  });

  test("没有 close 的 sink 跳过关闭流程，不影响旁边有 close 的", async () => {
    await withConsoleError((seen) => {
      const closed: string[] = [];
      const plain = () => {};
      const closable = Object.assign(() => {}, {
        close() {
          closed.push("closed");
        },
      });
      const logger = newLogger({ ...base, sinks: [plain, closable as never] });

      expect(() => logger.dispose()).not.toThrow();
      expect(closed).toEqual(["closed"]);
      // 没有 close 不是错误，不能走进 catch 里报「sink 抛错」
      expect(seen).toHaveLength(0);
    });
  });
});
