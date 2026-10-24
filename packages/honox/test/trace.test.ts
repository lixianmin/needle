import { describe, expect, test } from "bun:test";
import { newLogger, type LogRecord } from "@needle/logo";
import { Hono } from "hono";
import { traceOf } from "../src/trace.js";
import type { HonoxEnv } from "../src/types.js";

function setup() {
  const records: LogRecord[] = [];
  const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  return { records, log };
}

describe("traceOf", () => {
  test("绑定 rid / uid / method / path / module / site / fn", async () => {
    const { records, log } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (c, next) => {
      c.set("rid", "r1");
      c.set("uid", "u1");
      c.set("api", { module: "api/bots", site: "bots.ts:9", fn: "handler" });
      await next();
    });
    app.post("/bots", (c) => {
      traceOf(c, log).info({ ids: [1] });
      return c.json({ ok: true });
    });

    await app.request("/bots", { method: "POST" });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      rid: "r1",
      uid: "u1",
      method: "POST",
      path: "/bots",
      module: "api/bots",
      site: "bots.ts:9",
      fn: "handler",
      ids: [1],
      level: "info",
    });
  });

  test("业务字段覆盖同名绑定字段", async () => {
    const { records, log } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (c, next) => {
      c.set("rid", "r1");
      c.set("uid", "u1");
      await next();
    });
    app.get("/x", (c) => {
      traceOf(c, log).warn({ uid: "override" });
      return c.json({ ok: true });
    });

    await app.request("/x");

    expect(records[0]).toMatchObject({ uid: "override", level: "warn" });
  });

  test("没有 api 上下文时不出 module / site / fn", async () => {
    const { records, log } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (c, next) => {
      c.set("rid", "r1");
      c.set("uid", null);
      await next();
    });
    app.get("/x", (c) => {
      traceOf(c, log).debug({ a: 1 });
      return c.json({ ok: true });
    });

    await app.request("/x");

    const record = records[0];
    expect(record?.module).toBeUndefined();
    expect(record?.site).toBeUndefined();
    expect(record?.fn).toBeUndefined();
  });
});
