import { describe, expect, test } from "bun:test";
import { newLogger, type LogRecord } from "@needle/logo";
import { createHonox } from "../src/index.js";
import { createApi } from "../src/route.js";
import { sign } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import { RequestError } from "../src/request.js";

const SECRET = "test-secret";

function setup(options: { slowMs?: number } = {}) {
  const records: LogRecord[] = [];
  const logger = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  const app = createHonox({ logger, auth: { secret: SECRET }, slowMs: options.slowMs });
  return { app, records };
}

describe("兜底日志", () => {
  test("401：门禁拒绝记一条 warn，带 authError", async () => {
    const { app, records } = setup();
    app.get("/me", (ctx) => ctx.json({ uid: ctx.get("uid") }));

    const res = await app.request("/me");

    expect(res.status).toBe(401);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/me", status: 401, authError: "missing", level: "warn" });
    expect(records[0]).not.toHaveProperty("method");
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

  test("HTTPException：状态码照用，响应体仍是 {code, message}", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/slow-down"]);
    app.get("/slow-down", () => {
      throw new HTTPException(429, { message: "慢点" });
    });

    const res = await app.request("/slow-down");

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "too_many_requests", message: "慢点" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/slow-down", status: 429, level: "warn" });
  });

  test("HTTPException 5xx：消息不外泄（换成通用文案）", async () => {
    const { app } = setup();
    app.allowAnonymous(["/hidden"]);
    app.get("/hidden", () => {
      throw new HTTPException(500, { message: "数据库密码是 xxx" });
    });

    const res = await app.request("/hidden");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal_error", message: "服务内部错误" });
  });

  test("HTTPException 自带 res 时用它的（basic-auth 那种要带 WWW-Authenticate）", async () => {
    const { app } = setup();
    app.allowAnonymous(["/basic"]);
    app.get("/basic", () => {
      throw new HTTPException(401, {
        res: new Response("unauthorized", { status: 401, headers: { "www-authenticate": "Basic" } }),
      });
    });

    const res = await app.request("/basic");

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Basic");
    expect(await res.text()).toBe("unauthorized");
  });

  test("RequestError 带 5xx：仍然记一条 error（服务端故障不能隐身）", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/down"]);
    app.get("/down", () => {
      throw new RequestError(503, "unavailable", "下游不可用");
    });

    const res = await app.request("/down");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable", message: "下游不可用" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/down", status: 503, level: "error" });
  });

  test("慢请求：超过 slowMs 记一条 warn，带 durationMs", async () => {
    const { app, records } = setup({ slowMs: 10 });
    app.allowAnonymous(["/slow"]);
    app.get("/slow", async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return ctx.json({ ok: true });
    });

    await app.request("/slow");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/slow", status: 200, level: "warn" });
    expect(typeof records[0]?.durationMs).toBe("number");
  });

  // durationMs 保留 1 位小数。只断言「是数字」抓不住 *10/*10、now+start 这类改写；
  // 睡 30ms 时合理值在 25~200 之间，改写后会落到 300 或几百万。
  test("durationMs 是毫秒级一位小数，不是被放大过的数", async () => {
    const { app, records } = setup({ slowMs: 10 });
    app.allowAnonymous(["/slow2"]);
    app.get("/slow2", async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return ctx.json({ ok: true });
    });

    await app.request("/slow2");

    const duration = records[0]?.durationMs as number;
    expect(duration).toBeGreaterThan(20);
    expect(duration).toBeLessThan(200);
    expect(Number.isInteger(duration * 10)).toBe(true);
  });

  // 401 / 404 各自已经记过一行，慢请求不能再补一条；401 又是最常见的慢响应（客户端超时重试）。
  test("401 即使超过 slowMs 也不补第二条", async () => {
    const { app, records } = setup({ slowMs: 1 });
    app.get("/private", (ctx) => ctx.text("ok"));

    await app.request("/private");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 401 });
  });

  // RequestError 只跳过 4xx；status 500 的 RequestError 仍然要记（`<=` 会把它也跳过）。
  test("status 500 的 RequestError 照样记 error", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/boom"]);
    app.get("/boom", () => {
      throw new RequestError(500, "boom", "炸了");
    });

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    expect(records.filter((r) => r.level === "error")).toHaveLength(1);
  });

  // module / rid / uid / path 四个字段是排障时唯一的定位信息，缺一个就查不下去。
  test("日志字段：module、rid、uid、path 都在", async () => {
    const { app, records } = setup();
    const api = createApi("mod.ts");
    api.get("/mod", () => {
      throw new Error("boom");
    });
    app.route("/", api);
    app.allowAnonymous(["/mod"]);

    const token = await sign({ sub: "u1" }, SECRET, "HS256");
    await app.request("/mod", { headers: { authorization: `Bearer ${token}` } });

    const record = records.find((r) => r.level === "error");
    expect(record).toMatchObject({ path: "/mod", uid: "u1", module: "mod.ts", status: 500 });
    expect(typeof record?.rid).toBe("string");
  });

  test("未 finalize 的错误消息点明原因", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/nofin2"]);
    app.get("/nofin2", (() => undefined) as never);

    await Promise.resolve(app.request("/nofin2")).catch(() => null);

    const record = records.find((r) => r.level === "error");
    expect(String(record?.msg ?? JSON.stringify(record))).toMatch(/没有 finalize/);
  });

  test("慢请求阈值 0 时关闭", async () => {
    const { app, records } = setup({ slowMs: 0 });
    app.allowAnonymous(["/slow"]);
    app.get("/slow", async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ctx.json({ ok: true });
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
    app.onError((_error, ctx) => ctx.text("我自己的错误页", 500));

    const res = await app.request("/own");

    expect(res.status).toBe(500);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/own", status: 500, level: "error" });
  });

  test("不写日志的路由零日志", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/health"]);
    app.get("/health", (ctx) => ctx.json({ ok: true }));

    await app.request("/health");

    expect(records).toHaveLength(0);
  });
});
