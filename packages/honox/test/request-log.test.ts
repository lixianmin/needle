import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { newLogger, type LogRecord } from "@needle/logo";
import { createRequestLog } from "../src/middleware.js";
import type { HonoxEnv } from "../src/types.js";

function setup() {
  const records: LogRecord[] = [];
  const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  const app = new Hono<HonoxEnv>();
  app.use("*", async (c, next) => {
    c.set("rid", "r1");
    c.set("uid", null);
    await next();
  });
  app.use("*", createRequestLog(log));
  return { app, records };
}

describe("createRequestLog", () => {
  test("正常请求落两行，结束行带 path / status / durationMs / uid / rid（method 已去掉）", async () => {
    const { app, records } = setup();
    app.get("/orders", (c) => c.json({ ok: true }));
    await app.request("/orders");
    expect(records.map((r) => r.msg)).toEqual(["-->", "<--"]);
    const end = records[1]!;
    expect(end).toMatchObject({ path: "/orders", status: 200, uid: null, rid: "r1" });
    expect(typeof end.durationMs).toBe("number");
  });

  test("前端中间件短路成 401 时也有结束行", async () => {
    const { app, records } = setup();
    app.use("*", async (c) => c.json({ code: "unauthorized", message: "x" }, 401));
    app.get("/private", (c) => c.text("no"));
    const res = await app.request("/private");
    expect(res.status).toBe(401);
    expect(records.map((r) => r.msg)).toEqual(["-->", "<--"]);
    expect(records[1]).toMatchObject({ status: 401 });
  });

  test("未命中路由（404）也有结束行", async () => {
    const { app, records } = setup();
    const res = await app.request("/no-such-route");
    expect(res.status).toBe(404);
    expect(records.at(-1)).toMatchObject({ msg: "<--", status: 404 });
  });

  test("handler 抛错：落一条 error 并 rethrow，结束行 status 500", async () => {
    const { app, records } = setup();
    app.get("/boom", () => {
      throw new Error("kaboom");
    });
    app.onError((err, c) => c.text(err.message, 500));
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(records.some((r) => r.level === "error" && r.message === "kaboom")).toBe(true);
    expect(records.at(-1)).toMatchObject({ msg: "<--", status: 500 });
  });

  test("非 Error 抛出：仍记 error 行，结束行 status 500", async () => {
    const { app, records } = setup();
    app.get("/weird", () => {
      throw "boom-string";
    });
    await expect(app.request("/weird")).rejects.toBe("boom-string");
    expect(records.some((r) => r.level === "error")).toBe(true);
    expect(records.at(-1)).toMatchObject({ msg: "<--", status: 500 });
  });

  test("结束行的 uid 用请求结束时的值", async () => {
    const { app, records } = setup();
    app.use("*", async (c, next) => {
      c.set("uid", "u1");
      await next();
    });
    app.get("/me", (c) => c.json({ uid: c.get("uid") }));
    await app.request("/me");
    expect(records[1]).toMatchObject({ uid: "u1" });
  });
});
