import { describe, expect, test } from "bun:test";
import { formatLine, newLogger, type LogRecord } from "@needle/logo";
import { Hono } from "hono";
import { traceOf } from "../src/trace.js";
import type { HonoxEnv } from "../src/types.js";

function setup() {
  const records: LogRecord[] = [];
  const logger = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  return { records, logger };
}

describe("traceOf", () => {
  test("绑定 rid / uid / path / module（不带 method；module 只进前缀）", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", "u1");
      ctx.set("api", { module: "bots.ts" });
      await next();
    });
    app.post("/bots", (ctx) => {
      traceOf(ctx, logger).info({ ids: [1] });
      return ctx.json({ ok: true });
    });

    await app.request("/bots", { method: "POST" });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      rid: "r1",
      uid: "u1",
      path: "/bots",
      module: "bots.ts",
      ids: [1],
      level: "info",
    });
    // 注册位置不再进日志
    expect(records[0]).not.toHaveProperty("site");
    expect(records[0]).not.toHaveProperty("fn");
    // module 只出现在前缀：JSON 载荷里只有业务字段与 path
    expect(formatLine(records[0]!)).toMatch(
      /\[I\] bots\.ts \{"rid":"r1","uid":"u1","path":"\/bots","ids":\[1\]\}$/,
    );
  });

  test("业务字段覆盖同名绑定字段", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", "u1");
      await next();
    });
    app.get("/x", (ctx) => {
      traceOf(ctx, logger).warn({ uid: "override" });
      return ctx.json({ ok: true });
    });

    await app.request("/x");

    expect(records[0]).toMatchObject({ uid: "override", level: "warn" });
  });

  test("级别方法返回 trace 自己，可以一行写完「建 trace + 打日志」", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", null);
      await next();
    });
    let same = false;
    app.post("/x", (ctx) => {
      const trace = traceOf(ctx, logger).info({ step: 1 });
      same = trace === traceOf(ctx, logger) ? false : trace.info({ step: 2 }) === trace;
      return ctx.json({ ok: true });
    });

    await app.request("/x", { method: "POST" });

    expect(same).toBe(true);
    expect(records.map((r) => r.step)).toEqual([1, 2]);
  });

  test("debug / error 同样绑字段落盘，且返回 trace 自己", async () => {
    const { records, logger } = setup();
    // 默认阈值是 info，debug 会被 logger 丢掉——这条要证的恰恰是「真调到了 logger」，
    // 所以先把阈值打开，否则断言只能看到一条空记录（假绿）。
    logger.setLevel("debug");
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", "u1");
      await next();
    });
    let chained = false;
    app.get("/x", (ctx) => {
      const trace = traceOf(ctx, logger);
      chained = trace.debug({ step: "d" }).error({ step: "e" }) === trace;
      return ctx.json({ ok: true });
    });

    await app.request("/x");

    expect(records.map((r) => [r.level, r.step, r.rid])).toEqual([
      ["debug", "d", "r1"],
      ["error", "e", "r1"],
    ]);
    expect(chained).toBe(true);
  });

  test("json：记一条 info（status + result），返回 JSON 响应", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", null);
      await next();
    });
    app.get("/x", (ctx) => traceOf(ctx, logger).json({ bots: [1] }));

    const res = await app.request("/x");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bots: [1] });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 200, result: { bots: [1] }, path: "/x", level: "info" });
  });

  test("json：可以指定状态码", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", null);
      await next();
    });
    app.post("/x", (ctx) => traceOf(ctx, logger).json({ id: "a" }, 201));

    const res = await app.request("/x", { method: "POST" });

    expect(res.status).toBe(201);
    expect(records[0]).toMatchObject({ status: 201 });
  });

  test("notFound：记一条 info（status 404 + 响应体），返回 404", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", null);
      await next();
    });
    app.get("/x", (ctx) => traceOf(ctx, logger).notFound("bot 不存在"));

    const res = await app.request("/x");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "bot 不存在" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: 404,
      result: { code: "not_found", message: "bot 不存在" },
      level: "info",
    });
  });

  test("notFound 默认 message；想记业务字段就链一个 info", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", null);
      await next();
    });
    app.get("/x", (ctx) => {
      const trace = traceOf(ctx, logger);
      return trace.info({ id: 9, reason: "gone" }).notFound();
    });

    const res = await app.request("/x");

    expect(res.status).toBe(404);
    expect(records.map((r) => r.status)).toEqual([undefined, 404]);
    expect(records[0]).toMatchObject({ id: 9, reason: "gone" });
    // 不传 message 时的默认文案也是对外的（响应体里看得到）
    expect(await res.json()).toEqual({ code: "not_found", message: "接口不存在" });
  });

  test("失败出口：状态码、code、响应体与日志一一对应", async () => {
    const outlets = [
      { name: "badRequest", status: 400, code: "bad_request" },
      { name: "notFound", status: 404, code: "not_found" },
      { name: "internalError", status: 500, code: "internal_error" },
      { name: "unavailable", status: 503, code: "service_unavailable" },
    ] as const;

    for (const outlet of outlets) {
      const { records, logger } = setup();
      const app = new Hono<HonoxEnv>();
      app.use("*", async (ctx, next) => {
        ctx.set("rid", "r1");
        ctx.set("uid", null);
        await next();
      });
      app.get("/x", (ctx) => traceOf(ctx, logger)[outlet.name]("出事了"));

      const res = await app.request("/x");

      expect(res.status).toBe(outlet.status);
      expect(await res.json()).toEqual({ code: outlet.code, message: "出事了" });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        status: outlet.status,
        result: { code: outlet.code, message: "出事了" },
        level: "info",
      });
    }
  });

  test("失败出口不传 message 时的默认文案也是对外的", async () => {
    const defaults = [
      { name: "badRequest", status: 400, code: "bad_request", message: "请求不合法" },
      { name: "notFound", status: 404, code: "not_found", message: "接口不存在" },
      { name: "internalError", status: 500, code: "internal_error", message: "服务内部错误" },
      { name: "unavailable", status: 503, code: "service_unavailable", message: "服务暂不可用" },
    ] as const;

    for (const outlet of defaults) {
      const { records, logger } = setup();
      const app = new Hono<HonoxEnv>();
      app.use("*", async (ctx, next) => {
        ctx.set("rid", "r1");
        ctx.set("uid", null);
        await next();
      });
      app.get("/x", (ctx) => traceOf(ctx, logger)[outlet.name]());

      const res = await app.request("/x");

      expect(res.status).toBe(outlet.status);
      expect(await res.json()).toEqual({ code: outlet.code, message: outlet.message });
      expect(records[0]).toMatchObject({ status: outlet.status });
    }
  });

  test("没有 api 上下文时不出 module", async () => {
    const { records, logger } = setup();
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", null);
      await next();
    });
    app.get("/x", (ctx) => {
      traceOf(ctx, logger).info({ a: 1 });
      return ctx.json({ ok: true });
    });

    await app.request("/x");

    const record = records[0];
    expect(record?.path).toBe("/x");
    expect(record?.module).toBeUndefined();
    expect(record?.site).toBeUndefined();
  });
});
