import { describe, expect, test } from "bun:test";

import { buildRecord, safeStringify, sanitize } from "../src/record.js";

describe("buildRecord", () => {
  test("原始值按空格拼进 msg", () => {
    const record = buildRecord("info", ["a", 1, true]);
    expect(record.msg).toBe("a 1 true");
    expect(record.level).toBe("info");
    expect(typeof record.time).toBe("number");
    expect(Object.keys(record).sort()).toEqual(["level", "msg", "time"]);
  });

  test("纯对象合并进字段，不产生 msg", () => {
    const record = buildRecord("info", [{ a: 1 }]);
    expect(record.a).toBe(1);
    expect("msg" in record).toBe(false);
  });

  test("Error 展开成 message 与 stack", () => {
    const record = buildRecord("error", ["x", new Error("boom")]);
    expect(record.msg).toBe("x");
    expect(record.message).toBe("boom");
    expect(typeof record.stack).toBe("string");
  });

  test("循环引用不会让记录变成不可序列化", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const record = buildRecord("info", ["c", circular]);

    expect(() => JSON.stringify(record)).not.toThrow();
    expect(record.self).toBe("[Circular]");
  });

  test("BigInt 转成字符串", () => {
    const record = buildRecord("info", ["n", { big: 1n }]);
    expect(record.big).toBe("1");
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  test("保留字段压过同名业务字段（含 name：只能由 child 设置）", () => {
    const record = buildRecord("info", [{ level: "hack", msg: "no", time: 0, name: "hack" }], {
      name: "db",
    });
    expect(record.level).toBe("info");
    expect("msg" in record).toBe(false);
    expect(record.name).toBe("db");
    expect(typeof record.time).toBe("number");
    expect(record.time).not.toBe(0);

    // 没给 name 时业务字段也不能凭空造出一个
    expect("name" in buildRecord("info", [{ name: "hack" }])).toBe(false);
    // msg 同理：只有非对象参数才会填 msg
    expect("msg" in buildRecord("info", [{ msg: "hack" }])).toBe(false);
  });

  test("信封字段不抢键序：time / level 永远排在业务字段之后", () => {
    // time / level 会被无条件覆盖，但若它们漏过 ENVELOPE_FIELDS 就会先占住键位，
    // 记录的键序跟着变——日志文件的行内字段顺序对读的人是有意义的。
    const record = buildRecord("info", [{ time: 0, level: "hack", a: 1 }]);
    expect(Object.keys(record)).toEqual(["a", "time", "level"]);
  });

  test("options.site / options.fn 注入进去，业务数据已占同名键时不覆盖", () => {
    const injected = buildRecord("info", [], { site: "api/bots.ts:12", fn: "getBots" });
    expect(injected.site).toBe("api/bots.ts:12");
    expect(injected.fn).toBe("getBots");

    const kept = buildRecord("info", [{ site: "业务.ts:1", fn: "mine" }], {
      site: "api/bots.ts:12",
      fn: "getBots",
    });
    expect(kept.site).toBe("业务.ts:1");
    expect(kept.fn).toBe("mine");
  });

  test("保留字段在多个参数之间也一律丢掉", () => {
    const record = buildRecord("warn", [{ level: "info" }, { level: "error" }]);
    expect(record.level).toBe("warn");
  });

  test("数组当作值渲染进 msg", () => {
    const record = buildRecord("info", [[1, 2]]);
    expect(record.msg).toBe("[1,2]");
  });

  test("name 与 stack 由 options 注入", () => {
    const record = buildRecord("info", [], { name: "db", stack: "at x" });
    expect(record.name).toBe("db");
    expect(record.stack).toBe("at x");

    const bare = buildRecord("info", []);
    expect("name" in bare).toBe(false);
    expect("stack" in bare).toBe(false);
  });

  test("注入的调用栈不会覆盖 Error 自带的栈", () => {
    const error = new Error("boom");
    const record = buildRecord("error", [error], { stack: "at logger" });
    expect(record.stack).toBe(error.stack);
  });

  test("时间可以注入", () => {
    expect(buildRecord("info", [], { time: 42 }).time).toBe(42);
  });
});

describe("safeStringify", () => {
  test("序列化结果是 undefined 时退回 String(value)", () => {
    expect(safeStringify(undefined)).toBe("undefined");
  });

  test("sanitize 自己抛错时退回 String(value)，绝不把异常抛给调用方", () => {
    // entries() 一取就炸的 Map：sanitize 会抛，safeStringify 必须接住
    const hostile = new Proxy(new Map([[1, 2]]), {
      get(target, prop, receiver) {
        if (prop === "entries") {
          throw new Error("entries 炸了");
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    expect(safeStringify(hostile)).toBe("[object Map]");
  });

  test("普通值走 JSON", () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  test("循环引用降级成标记而不是抛错", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeStringify(circular)).toBe('{"self":"[Circular]"}');
  });

  test("序列化不了的值退回 String", () => {
    const hostile = {
      get boom(): never {
        throw new Error("nope");
      },
    };
    expect(safeStringify(hostile)).toBe('{"boom":"[Throws]"}');
  });
});

describe("共享引用与函数", () => {
  test("同一个对象出现在两个字段里不算循环引用", () => {
    const shared = { x: 1 };
    const date = new Date(0);
    const record = buildRecord("info", [{ a: shared, b: { c: shared }, d: date, e: date }], {});

    expect(record.b).toEqual({ c: { x: 1 } });
    expect(record.e).toBe("1970-01-01T00:00:00.000Z");
  });

  test("真正的环仍然被挡下", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;
    expect(buildRecord("info", [node], {}).self).toBe("[Circular]");
  });

  test("函数值转成 [Function]，不再原样进记录", () => {
    const record = buildRecord("info", [{ cb: () => 1, list: [() => 1] }], {});
    expect(record.cb).toBe("[Function]");
    expect(record.list).toEqual(["[Function]"]);
  });
});

// sanitize 是「日志不会把写入端炸掉」的唯一防线，它的边界值（8 层 / 10000 个节点）
// 必须逐个钉住：变异测试里这些边界一旦偏移，断言必须变红。
describe("sanitize 的边界", () => {
  const nest = (levels: number, wrap: (value: unknown) => unknown): unknown => {
    let value: unknown = "bottom";
    for (let i = 0; i < levels; i += 1) {
      value = wrap(value);
    }
    return value;
  };

  test("标量原样返回（不进 WeakSet：null / 原始值进去会抛）", () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeUndefined();
    expect(sanitize(42)).toBe(42);
    expect(sanitize("x")).toBe("x");
    expect(sanitize(true)).toBe(true);
    expect(sanitize(10n)).toBe("10");
  });

  test("第 8 层才是 [Depth]，四条递归路径各有自己的深度计数", () => {
    // 顶层 depth=0，所以 9 层包装的第 9 个进去时 depth=8。
    for (const wrap of [
      (value: unknown) => ({ n: value }),
      (value: unknown) => [value],
      (value: unknown) => new Set([value]),
      (value: unknown) => new Map([["k", value]]),
      (value: unknown) => new Map([[{ k: 1 }, value]]),   // 非字符串键走 sanitize 的分支
    ]) {
      expect(JSON.stringify(sanitize(nest(9, wrap)))).toContain("[Depth]");
    }

    // 7 层还看得到内容，说明不是「一律截断」
    expect(JSON.stringify(sanitize(nest(7, (value) => ({ n: value }))))).toContain("bottom");
  });

  test("预算正好 10000 个对象时，多出来的那个是 [Truncated]（且只有一个）", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 10_000; i += 1) {
      wide[`k${i}`] = {};
    }

    const json = JSON.stringify(sanitize(wide));
    expect(json.split("[Truncated]")).toHaveLength(2);
  });

  test("Object.keys 自己抛异常时整条记成 [Throws]", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("ownKeys 炸了");
      },
    });
    expect(sanitize(hostile)).toBe("[Throws]");
  });

  test("Map 的非字符串键按 sanitize 后的形态当键名（Date 不能退化成 toString）", () => {
    const sanitized = sanitize(new Map([[new Date(0), 1]])) as Record<string, unknown>;
    expect(Object.keys(sanitized)).toEqual(["1970-01-01T00:00:00.000Z"]);
  });

  test("没有 Headers 的环境（Workers 之外的老运行时）里 URLSearchParams 照样摊开", () => {
    const originalHeaders = globalThis.Headers;
    // @ts-expect-error 故意抽掉全局构造器
    delete globalThis.Headers;
    try {
      expect(sanitize({ a: 1 })).toEqual({ a: 1 });
      expect(sanitize(new URLSearchParams([["k", "v"]]))).toEqual({ k: "v" });
    } finally {
      globalThis.Headers = originalHeaders;
    }
  });

  test("纯对象按原型判：Object.create(null) 算，null / Date / 类实例不算", () => {
    expect(buildRecord("info", [{ a: 1 }]).msg).toBeUndefined();
    // null 不是纯对象：走的是「其余一切拼成 msg」，不是 safeStringify 的带引号形态
    expect(buildRecord("info", [null]).msg).toBe("null");
    expect(buildRecord("info", [Object.assign(Object.create(null), { a: 1 })]).a).toBe(1);
    expect(buildRecord("info", [new Date(0)]).msg).toContain("1970-01-01");
    class Thing {
      value = 1;
    }
    expect(buildRecord("info", [new Thing()]).msg).toContain('"value":1');
  });
});

describe("展开预算", () => {
  test("深层共享引用不会指数级展开", () => {
    let node: Record<string, unknown> = { leaf: 1 };
    for (let level = 0; level < 8; level += 1) {
      node = { a: node, b: node, c: node, d: node };
    }

    const json = safeStringify(buildRecord("info", [node], {}));
    expect(json).toContain("[Truncated]");
    expect(json.length).toBeLessThan(2_000_000);
  });
});

// spec 把这些类型列为「序列化后拼进 msg」的输入；旧实现走 Object.keys 得到 []，
// 于是 Map / Set / Headers 一律变成 "{}"，日志里只剩一个空对象，且没有任何标记。
describe("容器类型不被吞成空对象", () => {
  test("Map 的键值进 msg", () => {
    expect(buildRecord("info", [new Map([["a", 1]])]).msg).toBe('{"a":1}');
  });

  test("Set 的元素进 msg", () => {
    expect(buildRecord("info", [new Set([1, 2])]).msg).toBe("[1,2]");
  });

  test("Headers 的键值进 msg", () => {
    const headers = new Headers({ "x-rid": "r1" });
    expect(buildRecord("info", [headers]).msg).toBe('{"x-rid":"r1"}');
  });
});
