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

  test("级别方法返回 trace 自己，可以一行写完「建 trace + 打日志」", async () => {
    const { records, log } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (c, next) => {
      c.set("rid", "r1");
      c.set("uid", null);
      await next();
    });
    let same = false;
    app.post("/x", (c) => {
      const trace = traceOf(c, log).info({ step: 1 });
      same = trace === traceOf(c, log) ? false : trace.info({ step: 2 }) === trace;
      return c.json({ ok: true });
    });

    await app.request("/x", { method: "POST" });

    expect(same).toBe(true);
    expect(records.map((r) => r.step)).toEqual([1, 2]);
  });

  test("json：记一条 info（status + result），返回 JSON 响应", async () => {
    const { records, log } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (c, next) => {
      c.set("rid", "r1");
      c.set("uid", null);
      await next();
    });
    app.get("/x", (c) => traceOf(c, log).json({ bots: [1] }));

    const res = await app.request("/x");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bots: [1] });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 200, result: { bots: [1] }, path: "/x", level: "info" });
  });

  test("json：可以指定状态码", async () => {
    const { records, log } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (c, next) => {
      c.set("rid", "r1");
      c.set("uid", null);
      await next();
    });
    app.post("/x", (c) => traceOf(c, log).json({ id: "a" }, 201));

    const res = await app.request("/x", { method: "POST" });

    expect(res.status).toBe(201);
    expect(records[0]).toMatchObject({ status: 201 });
  });

  test("notFound：记一条 info（status 404 + 业务字段），返回 404", async () => {
    const { records, log } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (c, next) => {
      c.set("rid", "r1");
      c.set("uid", null);
      await next();
    });
    app.get("/x", (c) => traceOf(c, log).notFound({ id: 9, reason: "gone" }, "bot 不存在"));

    const res = await app.request("/x");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "bot 不存在" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 404, id: 9, reason: "gone", level: "info" });
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
