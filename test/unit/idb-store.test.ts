import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";

import { createIndexedDbStore, type IndexedDbStoreOptions } from "../../src/logo/sinks/idb.js";
import type { Level, LogRecord } from "../../src/logo/types.js";

let dbCounter = 0;

/** fake-indexeddb 是进程内共享的：每个测试用独立 DB 名，避免串状态。 */
function uniqueName(): string {
  dbCounter += 1;
  return `needle-test-${dbCounter}`;
}

const BASE_TIME = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** 默认把 now 注入到记录之后一天：cutoff 在所有测试记录之前，不触发过期清理。 */
function makeStore(overrides: Partial<IndexedDbStoreOptions> = {}) {
  return createIndexedDbStore({
    name: uniqueName(),
    now: () => BASE_TIME + DAY,
    ...overrides,
  });
}

const rec = (level: Level, msg: string, offset = 0): LogRecord => ({
  time: BASE_TIME + offset,
  level,
  msg,
});

/** 行格式与文件 sink 一致：`时间 [I] {json}`，取 json 段的 msg。 */
const msgOf = (line: string): string =>
  JSON.parse(line.slice(line.indexOf("] ") + 2) as string).msg as string;

describe("createIndexedDbStore", () => {
  test("写入与级联：info.log 收全、warn.log 收 warn+error、error.log 只收 error", async () => {
    const store = makeStore();
    store([rec("info", "i"), rec("warn", "w"), rec("error", "e")]);

    const entries = await store.list();
    expect(entries.map((entry) => entry.name)).toEqual(["info.log", "warn.log", "error.log"]);

    const info = await store.read("info.log");
    expect(info?.split("\n").map(msgOf)).toEqual(["i", "w", "e"]);
    const warn = await store.read("warn.log");
    expect(warn?.split("\n").map(msgOf)).toEqual(["w", "e"]);
    const error = await store.read("error.log");
    expect(error?.split("\n").map(msgOf)).toEqual(["e"]);
  });

  test("立即写：create 后马上 sink、连写两批，顺序不乱", async () => {
    const store = makeStore();
    store([rec("info", "a", 1)]);
    store([rec("info", "b", 2)]);

    const text = await store.read("info.log");
    expect(text?.split("\n").map(msgOf)).toEqual(["a", "b"]);
  });

  test("低于 minLevel 的记录写入时丢弃", async () => {
    const store = makeStore();
    store([rec("debug", "d"), rec("debug", "d2", 1)]);

    expect(await store.list()).toEqual([]);
    expect(await store.read("info.log")).toBeNull();
  });

  test("minLevel: debug 时 debug.log 出现且级联", async () => {
    const store = makeStore({ minLevel: "debug" });
    store([rec("debug", "d"), rec("info", "i", 1)]);

    const entries = await store.list();
    expect(entries.map((entry) => entry.name)).toEqual(["debug.log", "info.log", "warn.log", "error.log"]
      .filter((name) => name !== "warn.log" && name !== "error.log"));
    const debug = await store.read("debug.log");
    expect(debug?.split("\n").map(msgOf)).toEqual(["d", "i"]);
  });

  test("某级别 0 条记录时不列该文件", async () => {
    const store = makeStore();
    store([rec("info", "i")]);

    const entries = await store.list();
    expect(entries.map((entry) => entry.name)).toEqual(["info.log"]);
    expect(entries[0]?.size).toBeGreaterThan(0);
    expect(entries[0]?.modified).toBe(BASE_TIME);
  });

  test("sample 是末尾 5 行且每行不超 200 字符", async () => {
    const store = makeStore();
    const batch = Array.from({ length: 7 }, (_, index) => rec("info", `n-${index}`, index));
    store(batch);

    const entries = await store.list();
    const sampleLines = entries[0]?.sample?.split("\n") ?? [];
    expect(sampleLines).toHaveLength(5);
    expect(sampleLines.map(msgOf)).toEqual(["n-2", "n-3", "n-4", "n-5", "n-6"]);

    const text = (await store.read("info.log"))?.split("\n") ?? [];
    expect(sampleLines).toEqual(text.slice(-5));
    for (const line of sampleLines) {
      expect(line.length).toBeLessThanOrEqual(200);
    }
  });

  test("超过 maxRecords 按入库顺序删最旧", async () => {
    const store = makeStore({ maxRecords: 10 });
    store([rec("info", "old-1"), rec("info", "old-2", 1)]);
    store(Array.from({ length: 12 }, (_, index) => rec("info", `new-${index}`, 10 + index)));

    const text = await store.read("info.log");
    const messages = text?.split("\n").map(msgOf) ?? [];
    expect(messages).toHaveLength(10);
    expect(messages[0]).toBe("new-2");
  });

  test("keepDays 过期的记录被清理", async () => {
    const store = makeStore({ keepDays: 7, now: () => BASE_TIME });
    store([rec("info", "stale", -8 * DAY), rec("info", "fresh", 0)]);

    const text = await store.read("info.log");
    expect(text?.split("\n").map(msgOf)).toEqual(["fresh"]);
  });

  test("read 名单外返回 null", async () => {
    const store = makeStore();
    store([rec("info", "i")]);

    expect(await store.read("bogus.log")).toBeNull();
    // minLevel info 时 debug.log 不是候选文件
    expect(await store.read("debug.log")).toBeNull();
  });

  test("无 indexedDB 时降级：写不抛、list 为空、read 为 null", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error 测试模拟无痕模式
    delete globalThis.indexedDB;
    try {
      const store = makeStore();
      expect(() => store([rec("info", "i")])).not.toThrow();
      expect(await store.list()).toEqual([]);
      expect(await store.read("info.log")).toBeNull();
    } finally {
      globalThis.indexedDB = original as IDBFactory;
    }
  });

  test("close 后 sink 不再写、list 返回空", async () => {
    const store = makeStore();
    store([rec("info", "i")]);
    await store.list();

    store.close();
    store([rec("info", "late")]);

    expect(await store.list()).toEqual([]);
  });
});

describe("review 修复回归", () => {
  test("过期与超限同批出现：条数上限仍然精确", async () => {
    const store = makeStore({ maxRecords: 10 });
    store(Array.from({ length: 10 }, (_, index) => rec("info", `old-${index}`, index)));
    // 4 条过期 + 8 条新鲜：先删过期，再按上限裁最旧
    const batch = [
      ...Array.from({ length: 4 }, (_, index) => rec("info", `stale-${index}`, -8 * DAY - index)),
      ...Array.from({ length: 8 }, (_, index) => rec("info", `new-${index}`, 100 + index)),
    ];
    store(batch);

    const text = await store.read("info.log");
    const messages = text?.split("\n").map(msgOf) ?? [];
    expect(messages).toHaveLength(10);
    // 过期删的是 stale-*；超限按入库顺序裁掉 old-0..7，剩 old-8..9 + new-0..7
    expect(messages[0]).toBe("old-8");
    expect(messages).toContain("new-7");
    expect(messages.join("\n")).not.toContain("stale");
  });

  test("日志行不带存储自增的 id 键", async () => {
    const store = makeStore();
    store([rec("info", "i")]);

    const line = (await store.read("info.log"))?.split("\n")[0] ?? "";
    const payload = JSON.parse(line.slice(line.indexOf("] ") + 2) as string) as Record<string, unknown>;
    expect(payload).toEqual({ msg: "i" });
  });

  test("modified 取桶内最大 time（乱序批次也正确）", async () => {
    const store = makeStore();
    store([rec("info", "a", 500), rec("info", "b", 900), rec("info", "c", 100)]);

    const entries = await store.list();
    expect(entries[0]?.modified).toBe(BASE_TIME + 900);
  });
});
