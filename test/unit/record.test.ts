import { describe, expect, test } from "bun:test";

import { buildRecord, safeStringify } from "../../packages/logo/src/logo/record.js";

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

  test("保留字段压过同名业务字段", () => {
    const record = buildRecord("info", [{ level: "hack", msg: "no", time: 0 }]);
    expect(record.level).toBe("info");
    expect("msg" in record).toBe(false);
    expect(typeof record.time).toBe("number");
    expect(record.time).not.toBe(0);
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
