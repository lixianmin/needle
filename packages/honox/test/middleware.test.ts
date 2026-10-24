import { describe, expect, test } from "bun:test";
import { newLogger, type LogRecord } from "@needle/logo";
import { createHonox } from "../src/index.js";
import { HTTPException } from "hono/http-exception";
import { RequestError } from "../src/request.js";

const SECRET = "test-secret";

function setup(options: { slowMs?: number } = {}) {
  const records: LogRecord[] = [];
  const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  const app = createHonox({ logger: log, auth: { secret: SECRET }, slowMs: options.slowMs });
  return { app, records };
}

describe("兜底日志", () => {
  test("401：门禁拒绝记一条 warn，带 authError", async () => {
    const { app, records } = setup();
    app.get("/me", (c) => c.json({ uid: c.get("uid") }));

    const res = await app.request("/me");

    expect(res.status).toBe(401);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ method: "GET", path: "/me", status: 401, authError: "missing", level: "warn" });
  });

  test("404：记一条 info", async () => {
    const { app, records } = setup();
    // 门禁在路由之前，路径不放进白名单的话先被拦成 401，走不到 notFound。
    app.allowAnonymous(["/nope"]);

    const res = await app.request("/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/nope", status: 404, level: "info" });
  });

  test("抛 Error：记一条 error（带栈），响应是 ResponseX 契约", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/boom"]);
    app.get("/boom", () => {
      throw new Error("boom");
    });

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal_error" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/boom", status: 500, level: "error" });
    expect(records[0]?.stack).toContain("Error: boom");
  });

  test("RequestError：响应 400，且不记 error 日志", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/bad"]);
    app.post("/bad", () => {
      throw new RequestError("参数不对");
    });

    const res = await app.request("/bad", { method: "POST" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_request", message: "参数不对" });
    expect(records.filter((r) => r.level === "error")).toHaveLength(0);
  });

  test("非 Error 抛出：记一条 error，响应 500", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/weird"]);
    app.get("/weird", () => {
      throw "字符串";
    });

    // compose 与非 Error 抛出都不认它，fetch 会直接 reject（不会变成 500 响应体）——
    // 这正是必须在这里记一条的原因：没有任何地方会替它记账。
    await expect(app.request("/weird")).rejects.toBe("字符串");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/weird", status: 500, level: "error" });
    expect(typeof records[0]?.durationMs).toBe("number");
  });

  test("handler 既不返回 Response 也不 await next()：记一条 error", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/nofinal"]);
    // 唯一能造出未 finalize 的方式：handler 什么都不返回。
    app.get("/nofinal", (() => undefined) as never);

    const res = await Promise.resolve(app.request("/nofinal")).catch(() => null);

    expect(res === null || res.status === 500).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/nofinal", status: 500, level: "error" });
  });

  test("HTTPException：按它自己的状态码返回，4xx 记 warn 不记 error", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/teapot"]);
    app.get("/teapot", () => {
      throw new HTTPException(418, { message: "我是个茶壶" });
    });

    const res = await app.request("/teapot");

    expect(res.status).toBe(418);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/teapot", status: 418, level: "warn" });
  });

  test("慢请求：超过 slowMs 记一条 warn，带 durationMs", async () => {
    const { app, records } = setup({ slowMs: 10 });
    app.allowAnonymous(["/slow"]);
    app.get("/slow", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return c.json({ ok: true });
    });

    await app.request("/slow");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/slow", status: 200, level: "warn" });
    expect(typeof records[0]?.durationMs).toBe("number");
  });

  test("慢请求阈值 0 时关闭", async () => {
    const { app, records } = setup({ slowMs: 0 });
    app.allowAnonymous(["/slow"]);
    app.get("/slow", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return c.json({ ok: true });
    });

    await app.request("/slow");

    expect(records).toHaveLength(0);
  });

  test("业务自装 onError：500 仍有日志", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/own"]);
    app.get("/own", () => {
      throw new Error("own");
    });
    app.onError((_error, c) => c.text("我自己的错误页", 500));

    const res = await app.request("/own");

    expect(res.status).toBe(500);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/own", status: 500, level: "error" });
  });

  test("不写日志的路由零日志", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/health"]);
    app.get("/health", (c) => c.json({ ok: true }));

    await app.request("/health");

    expect(records).toHaveLength(0);
  });
});
