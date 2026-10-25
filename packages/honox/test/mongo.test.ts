import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { createMongo } from "../src/mongo.js";

function fakeClient() {
  const calls = { dbNames: [] as (string | undefined)[], closed: 0, sessions: 0 };
  const client = {
    db(name?: string) {
      calls.dbNames.push(name);
      return { databaseName: name ?? "from-uri" };
    },
    withSession: async (fn: (session: unknown) => Promise<unknown>) => {
      calls.sessions += 1;
      return fn({ withTransaction: async (cb: () => Promise<unknown>) => cb() });
    },
    close: async () => {
      calls.closed += 1;
    },
  };
  return { client: client as unknown as MongoClient, calls };
}

describe("createMongo", () => {
  test("db() 透传库名", () => {
    const { client, calls } = fakeClient();
    const mongo = createMongo({ uri: "mongodb://x/y", db: "app", client });
    expect((mongo.db() as unknown as { databaseName: string }).databaseName).toBe("app");
    expect(calls.dbNames).toEqual(["app"]);
  });

  test("不传 db 时用连接串里的库名（driver 默认）", () => {
    const { client, calls } = fakeClient();
    const mongo = createMongo({ uri: "mongodb://x/y", client });
    expect((mongo.db() as unknown as { databaseName: string }).databaseName).toBe("from-uri");
    expect(calls.dbNames).toEqual([undefined]);
  });

  test("withTransaction 把 session 交给回调", async () => {
    const { client } = fakeClient();
    const mongo = createMongo({ uri: "mongodb://x/y", client });
    const seen: unknown[] = [];
    const result = await mongo.withTransaction(async (session) => {
      seen.push(session);
      return 42;
    });
    expect(result).toBe(42);
    expect(seen).toHaveLength(1);
  });

  test("注入的 client 不被 close", async () => {
    const { client, calls } = fakeClient();
    const mongo = createMongo({ uri: "mongodb://x/y", client });
    await mongo.close();
    await mongo.close();
    expect(calls.closed).toBe(0);
  });

  test("自建的 client close 幂等", async () => {
    const mongo = createMongo({ uri: "mongodb://127.0.0.1:27017/x" });
    await mongo.close();
    await mongo.close();
  });
});

describe("所有权：只有自建的 client 才关", () => {
  // 注入的 client 由调用方管生命周期；自建的要关，且只关一次。
  // `owned` / `closed` 这两个标志没有返回值，只能通过对 driver 的原型打桩观测。
  test("自建 client 关闭一次，重复 close 不再调 driver", async () => {
    const original = MongoClient.prototype.close;
    let calls = 0;
    MongoClient.prototype.close = async function patched(this: MongoClient) {
      calls += 1;
      return undefined;
    };

    try {
      const mongo = createMongo({ uri: "mongodb://127.0.0.1:27017/x" });
      await mongo.close();
      await mongo.close();
      expect(calls).toBe(1);
    } finally {
      MongoClient.prototype.close = original;
    }
  });

  test("注入的 client 一次都不关", async () => {
    const original = MongoClient.prototype.close;
    let calls = 0;
    MongoClient.prototype.close = async function patched() {
      calls += 1;
      return undefined;
    };

    try {
      const { client } = fakeClient();
      const mongo = createMongo({ uri: "mongodb://x/y", client });
      await mongo.close();
      expect(calls).toBe(0);
    } finally {
      MongoClient.prototype.close = original;
    }
  });
});
