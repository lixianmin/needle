import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";

import { newLogger } from "../../src/logo/logo.js";
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

/** 造一个 v1 布局的库（keyPath "id"）并返回打开的连接。 */
function openLegacyV1(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("records", { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 直接读原始库：绕过 store 自己的 close 守卫。 */
function rawAll(dbName: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction("records", "readonly");
      const getAll = tx.objectStore("records").getAll();
      getAll.onsuccess = () => {
        database.close();
        resolve(getAll.result as Array<Record<string, unknown>>);
      };
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/** 试着以指定版本打开：被挡或失败都返回 false，不抛。 */
function tryOpenVersion(dbName: string, version: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName, version);
    request.onupgradeneeded = () => {};
    request.onsuccess = () => {
      request.result.close();
      resolve(true);
    };
    request.onblocked = () => resolve(false);
    request.onerror = () => resolve(false);
  });
}

/** 轮询到条件成立为止。固定 sleep 在慢机器上会假失败。 */
async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("等待条件超时");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("复审修复", () => {
  test("业务字段 id 不与存储主键撞车，也不被吞掉", async () => {
    const store = makeStore();
    // 订单号是最常见的 id：同一条日志里出现两次不能互相覆盖
    store([
      { time: BASE_TIME, level: "info", msg: "order-a", id: "A-1" },
      { time: BASE_TIME, level: "info", msg: "order-b", id: "A-1" },
      { time: BASE_TIME, level: "info", msg: "order-c", id: "A-2" },
    ]);

    const lines = (await store.read("info.log"))?.split("\n") ?? [];
    expect(lines.map(msgOf)).toEqual(["order-a", "order-b", "order-c"]);
    const payload = JSON.parse(lines[0]?.slice((lines[0] ?? "").indexOf("] ") + 2) as string) as {
      id: string;
    };
    expect(payload.id).toBe("A-1");
  });

  test("旧版（inline keyPath）库升级后 id 字段不再撞车", async () => {
    const name = uniqueName();
    // 造一个 v1 库（本次修复前的布局）
    const legacy = await openLegacyV1(name);
    legacy.close();

    const store = createIndexedDbStore({ name, now: () => BASE_TIME + DAY });
    store([
      { time: BASE_TIME, level: "info", msg: "a", id: "X" },
      { time: BASE_TIME, level: "info", msg: "b", id: "X" },
    ]);

    const lines = (await store.read("info.log"))?.split("\n") ?? [];
    expect(lines.map(msgOf)).toEqual(["a", "b"]);
  });

  test("记录里的 id 为 null 也不中断整批写入", async () => {
    const store = makeStore();
    store([
      { time: BASE_TIME, level: "info", msg: "guest", id: null },
      { time: BASE_TIME, level: "info", msg: "after-null" },
    ]);

    const lines = (await store.read("info.log"))?.split("\n") ?? [];
    expect(lines.map(msgOf)).toEqual(["guest", "after-null"]);
  });

  test("close 之前排队的批次仍然落库（logger.dispose 的顺序）", async () => {
    const name = uniqueName();
    const store = createIndexedDbStore({ name, now: () => BASE_TIME + DAY });
    // 模拟 logger.dispose：先 flush（sink 入队），紧接着 close
    store([rec("info", "final")]);
    store.close();

    const rows = await waitFor(async () => {
      const all = await rawAll(name);
      return all.length > 0 ? all : null;
    });
    expect(rows.map((row) => row.msg)).toEqual(["final"]);
  });

  test("open 完成前 close 不会留下占着版本的连接", async () => {
    const name = uniqueName();
    const store = createIndexedDbStore({ name });
    store.close(); // 此刻 open 还没完成

    const upgraded = await waitFor(async () => ((await tryOpenVersion(name, 3)) ? true : null));
    expect(upgraded).toBe(true);
  });
});

describe("升级被挡", () => {
  /** 临时接管 console.error：blocked 是异步上报的，等到它真的发生再继续。 */
  async function withConsoleErrors<T>(fn: (errors: string[]) => Promise<T>): Promise<T> {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      return await fn(errors);
    } finally {
      console.error = original;
    }
  }

  test("blocked 解除后连接不残留，store 也不会永久降级", async () => {
    const name = uniqueName();
    const legacy = await openLegacyV1(name); // 旧标签页占着 v1 连接

    await withConsoleErrors(async (errors) => {
      const store = createIndexedDbStore({ name, now: () => BASE_TIME + DAY });
      store([rec("info", "during-block")]); // 被挡期间的这批注定丢，不断言

      // 必须先等到 blocked 真的上报，否则「关掉旧连接」与「发起 open」同轮，
      // 升级根本不会被挡，这个测试就什么都没验证。
      await waitFor(async () => (errors.some((line) => line.includes("阻塞")) ? true : null));

      legacy.close(); // 旧标签页让路，升级随后完成

      // 1) 阻塞解除后必须还能继续写（不永久降级）
      const lines = await waitFor(async () => {
        store([rec("info", "after-unblock")]);
        const parsed = (await store.read("info.log"))?.split("\n") ?? [];
        return parsed.some((line) => line.includes("after-unblock")) ? parsed : null;
      });
      expect(lines).toHaveLength(1);

      // 2) 自己的连接也不能残留挡住别人的升级（v3 会触发 versionchange，放在最后）
      const upgraded = await waitFor(async () => ((await tryOpenVersion(name, 3)) ? true : null));
      expect(upgraded).toBe(true);
    });
  });
});

describe("版本升级让路", () => {
  test("别的上下文要升级版本时让路，不把对方卡死", async () => {
    const name = uniqueName();
    const store = createIndexedDbStore({ name, now: () => BASE_TIME + DAY });
    store([rec("info", "a")]);
    await store.list(); // 确保连接已建立

    const upgraded = await new Promise<boolean>((resolve) => {
      const request = indexedDB.open(name, 3);
      request.onupgradeneeded = () => {};
      request.onsuccess = () => {
        request.result.close();
        resolve(true);
      };
      request.onblocked = () => resolve(false);
      request.onerror = () => resolve(false);
    });
    expect(upgraded).toBe(true);
  });
});

describe("版本变更让路", () => {
  test("versionchange 让路时不吞掉已排队的批次", async () => {
    const name = uniqueName();
    const store = createIndexedDbStore({ name, now: () => BASE_TIME + DAY });
    store([rec("info", "warmup", 0)]);
    await store.list(); // 等连接建立

    // 排一批在队列里，再立刻请求升级：versionchange 必然在队列还没跑完时到达
    const BURST = 100;
    for (let index = 0; index < BURST; index += 1) {
      store([rec("info", `burst-${index}`, index + 1)]);
    }

    const upgraded = await waitFor(async () => ((await tryOpenVersion(name, 3)) ? true : null));
    expect(upgraded).toBe(true);

    const rows = await waitFor(async () => {
      const all = await rawAll(name);
      return all.length >= BURST ? all : null;
    });
    // 立刻 close 连接的实现会把队列后半截丢掉，这里只剩前面几条
    expect(rows.map((row) => row.msg)).toContain(`burst-${BURST - 1}`);
  });
});

describe("脏记录隔离", () => {
  test("单条不可克隆的记录不会拖累同批其它记录", async () => {
    const store = makeStore();
    store([
      { time: BASE_TIME, level: "info", msg: "before" },
      // 函数值不可结构化克隆：put 会同步抛 DataCloneError
      { time: BASE_TIME, level: "info", msg: "poison", bad: () => {} },
      { time: BASE_TIME, level: "info", msg: "after" },
    ]);

    const lines = (await store.read("info.log"))?.split("\n") ?? [];
    expect(lines.map(msgOf)).toEqual(["before", "after"]);
  });
});

describe("文档里的接线", () => {
  test("newLogger + store + dispose（pagehide 用法）最后一批仍落库", async () => {
    const name = uniqueName();
    const store = createIndexedDbStore({ name, now: () => BASE_TIME + DAY });
    const log = newLogger({ batch: true, flushIntervalMs: 16, sinks: [store] });

    log.info("first");
    log.info("second");
    log.dispose(); // 文档：addEventListener("pagehide", () => log.dispose())

    // 轮询到落盘，再用新连接读回
    const lines = await waitFor(async () => {
      const reopened = createIndexedDbStore({ name, now: () => BASE_TIME + DAY });
      const parsed = (await reopened.read("info.log"))?.split("\n") ?? [];
      reopened.close();
      return parsed.length >= 2 ? parsed : null;
    });
    expect(lines.map(msgOf)).toEqual(["first", "second"]);
  });
});
