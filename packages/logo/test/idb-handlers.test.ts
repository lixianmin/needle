import { describe, expect, test } from "bun:test";

import { awaitRequest, awaitTransaction, createIndexedDbStore, nextCursor } from "../src/sinks/idb.js";
import type { LogRecord } from "../src/types.js";

/**
 * open 的四个事件处理器（onupgradeneeded / onsuccess / onerror / onblocked）和
 * versionchange，只有拿假 factory 才能逐个触发：fake-indexeddb 里「打开失败」
 * 「升级被挡」「别的上下文改版本」都要求另一个真实连接配合，顺序也控不住。
 */

interface FakeRequest {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

function makeRequest(): FakeRequest {
  return { result: undefined, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
}

/** 换掉全局 factory 跑一段，结束后恢复。 */
async function withFactory<T>(
  factory: { open: () => FakeRequest },
  run: (request: FakeRequest) => Promise<T> | T,
): Promise<T> {
  const original = globalThis.indexedDB;
  const request = makeRequest();
  factory.open = () => request;
  globalThis.indexedDB = factory as unknown as IDBFactory;
  try {
    return await run(request);
  } finally {
    globalThis.indexedDB = original;
  }
}

/** 抓住 console.error：这些分支的契约有一半是「恰好提示一次，且提示得能定位」。 */
async function withConsoleError<T>(run: (lines: string[]) => Promise<T> | T): Promise<T> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    return await run(lines);
  } finally {
    console.error = original;
  }
}

const record = (msg: string): LogRecord => ({ time: 1_700_000_000_000, level: "info", msg });

/** 用来把「永远不落地」换成失败，而不是把整个测试挂死。 */
const timeoutAfter = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error("等太久：promise 没有落地")), 1000);
});

describe("awaitRequest / awaitTransaction", () => {
  test("请求失败时用 request.error 拒绝（不是静默 resolve）", async () => {
    const request = { error: new Error("boom") } as unknown as IDBRequest<string>;
    const promise = awaitRequest(request);
    (request as unknown as { onerror: () => void }).onerror();
    await expect(promise).rejects.toThrow("boom");
  });

  test("事务完成时 resolve", async () => {
    const tx = {} as IDBTransaction;
    const promise = awaitTransaction(tx);
    (tx as unknown as { oncomplete: () => void }).oncomplete();
    await expect(promise).resolves.toBeUndefined();
  });

  test("事务 error 时用 tx.error 拒绝", async () => {
    const tx = { error: new Error("tx boom") } as unknown as IDBTransaction;
    const promise = awaitTransaction(tx);
    (tx as unknown as { onerror: () => void }).onerror();
    await expect(promise).rejects.toThrow("tx boom");
  });

  test("事务 abort 且没有 error 对象时，也得给出可读的拒绝理由", async () => {
    const tx = { error: null } as unknown as IDBTransaction;
    const promise = awaitTransaction(tx);
    (tx as unknown as { onabort: () => void }).onabort();
    // 不能是一个 undefined 的拒绝：上层只会打一条「出错」而看不到任何原因
    await expect(promise).rejects.toThrow("transaction aborted");
  });
});

describe("open 的升级回调", () => {
  test("全新库：建 store（out-of-line 键 + autoIncrement）与时间索引", async () => {
    const created: { name: string; options: unknown }[] = [];
    const indexes: string[][] = [];
    const database = {
      objectStoreNames: { contains: () => false },
      deleteObjectStore: () => {
        throw new Error("全新库不该删 store");
      },
      createObjectStore: (name: string, options: unknown) => {
        created.push({ name, options });
        return { createIndex: (indexName: string) => indexes.push([indexName]) };
      },
    };

    await withFactory({ open: () => makeRequest() }, async (request) => {
      createIndexedDbStore({ name: "fake" });
      request.result = database;
      request.onupgradeneeded?.();

      expect(created).toEqual([{ name: "records", options: { autoIncrement: true } }]);
      expect(indexes).toEqual([["by_time"]]);
    });
  });

  test("已有 v1 的 store：先删再建（旧布局的 inline 键是丢日志的根源）", async () => {
    const deleted: string[] = [];
    const database = {
      objectStoreNames: { contains: () => true },
      deleteObjectStore: (name: string) => deleted.push(name),
      createObjectStore: () => ({ createIndex: () => {} }),
    };

    await withFactory({ open: () => makeRequest() }, async (request) => {
      createIndexedDbStore({ name: "fake" });
      request.result = database;
      request.onupgradeneeded?.();

      expect(deleted).toEqual(["records"]);
    });
  });
});

describe("open 的失败与阻塞", () => {
  test("打开失败：降级但不静默，写与读都不抛", async () => {
    await withConsoleError(async (lines) => {
      await withFactory({ open: () => makeRequest() }, async (request) => {
        const store = createIndexedDbStore({ name: "fake" });
        request.error = new Error("open boom");
        request.onerror?.();

        expect(() => store([record("x")])).not.toThrow();
        expect(await store.list()).toEqual([]);
        expect(await store.read("info.log")).toBeNull();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("[logo]");
        expect(lines[0]).toContain("open boom");
      });
    });
  });

  test("被挡时先报一条并放行 ready；对方让路后连接照用，不永久降级", async () => {
    await withConsoleError(async (lines) => {
      await withFactory({ open: () => makeRequest() }, async (request) => {
        const store = createIndexedDbStore({ name: "fake" });
        request.onblocked?.();

        // 报一条「阻塞」，但 ready 已放行：读能立刻返回，不会把 tail 卡死
        expect(lines.some((line) => line.includes("阻塞"))).toBe(true);
        expect(await store.list()).toEqual([]);

        // 对方让路，这次 open 成功：连接必须被接管
        const connection = {
          close: () => {},
          onversionchange: null as null | (() => void),
          transaction: () => {
            throw new Error("这条测试不在乎写入");
          },
        };
        request.result = connection;
        request.onsuccess?.();
        // 报错只提示一次：前面的阻塞已经报过，这里不该再刷一条
        expect(lines).toHaveLength(1);
        expect(connection.onversionchange).not.toBeNull();
      });
    });
  });

  test("别的上下文要升级版本：报一条并停写（新批次不进队列）", async () => {
    await withConsoleError(async (lines) => {
      await withFactory({ open: () => makeRequest() }, async (request) => {
        const store = createIndexedDbStore({ name: "fake" });
        let transactions = 0;
        const connection = {
          close: () => {},
          onversionchange: null as null | (() => void),
          transaction: () => {
            transactions += 1;
            throw new Error("这条测试不在乎写入");
          },
        };
        request.result = connection;
        request.onsuccess?.();

        connection.onversionchange?.();

        expect(lines[0]).toContain("版本被其它上下文升级");
        // close() 之后新批次直接丢弃：不再开事务
        store([record("after")]);
        await Promise.resolve();
        expect(transactions).toBe(0);
      });
    });
  });

  test("已 close 且没有排队工作时，open 一完成就关连接（不留着挡别人的升级）", async () => {
    await withConsoleError(async (lines) => {
      await withFactory({ open: () => makeRequest() }, async (request) => {
        const store = createIndexedDbStore({ name: "fake" });
        store.close();

        let closedCount = 0;
        const connection = { close: () => (closedCount += 1), onversionchange: null };
        request.result = connection;
        request.onsuccess?.();

        expect(closedCount).toBe(1);
        expect(lines).toHaveLength(0);
        // ready 必须放行：否则 tail 链上所有读写永远挂着
        await expect(Promise.race([store.list(), timeoutAfter])).resolves.toEqual([]);
      });
    });
  });

  test("有排队工作时，open 完成不能提前关连接（那批会静默丢）", async () => {
    await withConsoleError(async (lines) => {
      await withFactory({ open: () => makeRequest() }, async (request) => {
        const store = createIndexedDbStore({ name: "fake" });
        store([record("queued")]); // 先排队，再 close
        store.close();

        let closedCount = 0;
        const connection = {
          close: () => (closedCount += 1),
          onversionchange: null,
          transaction: () => {
            throw new Error("这条测试不在乎写入");
          },
        };
        request.result = connection;
        request.onsuccess?.();

        expect(closedCount).toBe(0);
        // 让排队的批次跑完（它会撞到上面那个 transaction 抛错并被接住）
        await store.list();
        expect(closedCount).toBe(1);
        // 写失败必须留下一条线索，且只留一条
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("这条测试不在乎写入");
      });
    });
  });
});

describe("nextCursor", () => {
  test("有值时 resolve 成游标本身", async () => {
    const cursor = { value: undefined } as unknown as IDBCursorWithValue;
    const request = { result: cursor } as unknown as IDBRequest<IDBCursorWithValue | null>;
    const promise = nextCursor(request);
    (request as unknown as { onsuccess: () => void }).onsuccess();
    await expect(promise).resolves.toBe(cursor);
  });

  test("游标走完时 resolve 成 null", async () => {
    const request = { result: null } as unknown as IDBRequest<IDBCursorWithValue | null>;
    const promise = nextCursor(request);
    (request as unknown as { onsuccess: () => void }).onsuccess();
    await expect(promise).resolves.toBeNull();
  });

  test("请求失败时用 request.error 拒绝（否则 tail 链永久卡住）", async () => {
    const request = { error: new Error("cursor boom") } as unknown as IDBRequest<IDBCursorWithValue | null>;
    const promise = nextCursor(request);
    (request as unknown as { onerror: () => void }).onerror();
    await expect(promise).rejects.toThrow("cursor boom");
  });

  test("失败但没有 error 对象时也要给出可读理由", async () => {
    const request = { error: null } as unknown as IDBRequest<IDBCursorWithValue | null>;
    const promise = nextCursor(request);
    (request as unknown as { onerror: () => void }).onerror();
    await expect(promise).rejects.toThrow("cursor failed");
  });
});

describe("读路径的失败与关闭", () => {
  test("读失败要留线索，并以 fallback 收场（不能当成「没有日志」还不出声）", async () => {
    await withConsoleError(async (lines) => {
      await withFactory({ open: () => makeRequest() }, async (request) => {
        const store = createIndexedDbStore({ name: "fake" });
        request.result = {
          close: () => {},
          onversionchange: null,
          transaction: () => {
            throw new Error("read boom");
          },
        };
        request.onsuccess?.();

        expect(await store.list()).toEqual([]);
        expect(await store.read("info.log")).toBeNull();
        // 两次读都失败了，但只提示一次
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("read boom");
      });
    });
  });

  test("排在 close 之前、但在 close 之后才轮到执行的读，仍然返回空", async () => {
    await withConsoleError(async (lines) => {
      await withFactory({ open: () => makeRequest() }, async (request) => {
        const store = createIndexedDbStore({ name: "fake" });
        let transactions = 0;
        request.result = {
          close: () => {},
          onversionchange: null,
          transaction: () => {
            transactions += 1;
            throw new Error("这条测试不在乎读");
          },
        };
        request.onsuccess?.();

        // 先把读排进队列，再同步 close：读轮到自己时 closed 已经是 true
        const pendingRead = store.list();
        store.close();

        expect(await pendingRead).toEqual([]);
        // 队列里排着的那次读不该真的去开事务
        expect(transactions).toBe(0);
        expect(lines).toHaveLength(0);
      });
    });
  });
});
