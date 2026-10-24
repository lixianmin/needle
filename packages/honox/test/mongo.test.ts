import { describe, expect, test } from "bun:test";
import type { MongoClient } from "mongodb";
import { createMongo } from "@needle/honox/mongo";

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
