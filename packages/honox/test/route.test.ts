import { beforeEach, describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { newLogger, type LogRecord } from "@needle/logo";
import { Hono, type Handler } from "hono";
import { clearModels, registerModel } from "../src/model.js";
import { ResponseX } from "@needle/shell";
import { isRequestError } from "../src/request.js";
import { createApi } from "../src/route.js";
import { traceOf } from "../src/trace.js";
import type { HonoxEnv } from "../src/types.js";

class BotsQuery {
  id?: number;
}

class BotsBody {
  ids: number[] = [];
}

/** 最小宿主：只装一条 onError 把 RequestError 映射成 400，其余 500 带 message。 */
function host(): Hono<HonoxEnv> {
  const app = new Hono<HonoxEnv>();
  app.onError((error, ctx) => {
    if (isRequestError(error)) {
      return ResponseX.fail(error.status, error.code, error.message);
    }

    return ctx.text(String(error), 500);
  });
  return app;
}

const json = (payload: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(payload),
  headers: { "content-type": "application/json" },
});

describe("createApi", () => {
  beforeEach(() => {
    clearModels();
    registerModel("BotsQuery", Type.Object({ id: Type.Optional(Type.Number()) }));
    registerModel("BotsBody", Type.Object({ ids: Type.Array(Type.Number()) }, { additionalProperties: false }));
  });

  test("POST + 模型：body 解析后作为第二个参数", async () => {
    const app = host();
    const api = createApi("bots.ts");
    api.post("/bots", BotsBody, (ctx, body) => ctx.json({ got: body.ids }));
    app.route("/", api);

    const ok = await app.request("/bots", json({ ids: [1, 2] }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ got: [1, 2] });
  });

  // HTTP 的 QUERY 方法就是「把查询条件放 body 的 safe 方法」；算成 query 会让 body 被静默丢弃。
  test("QUERY + 模型：读 body 而不是 query 串", async () => {
    const app = host();
    const api = createApi("search.ts");
    api.query("/search", BotsBody, (ctx, body) => ctx.json({ got: body.ids }));
    app.route("/", api);

    const res = await app.request("/search", {
      method: "QUERY",
      body: JSON.stringify({ ids: [3] }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: [3] });
  });

  test("POST + 模型：body 不合法 → 400", async () => {
    const app = host();
    const api = createApi("bots.ts");
    api.post("/bots", BotsBody, (ctx, body) => ctx.json({ got: body.ids }));
    app.route("/", api);

    const bad = await app.request("/bots", json({ ids: ["1"] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "bad_request" });
  });

  test("GET + 模型：解析的是 query", async () => {
    const app = host();
    const api = createApi("bots.ts");
    api.get("/bots", BotsQuery, (ctx, query) => ctx.json({ id: query.id ?? null }));
    app.route("/", api);

    expect(await (await app.request("/bots?id=7")).json()).toEqual({ id: 7 });
  });

  test("带模型的写法也把 module 写进日志前缀", async () => {
    const records: LogRecord[] = [];
    const logger = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
    const app = host();
    const api = createApi("bots.ts");
    api.post("/bots", BotsBody, (ctx, body) => traceOf(ctx, logger).json({ got: body.ids }));
    app.route("/", api);

    await app.request("/bots", json({ ids: [1] }));

    expect(records).toHaveLength(1);
    expect(records[0]?.module).toBe("bots.ts");
  });

  test("不传模型的老写法照旧", async () => {
    const app = host();
    const api = createApi("health.ts");
    api.get("/health", (ctx) => ctx.json({ ok: true }));
    app.route("/", api);

    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });

  test("模型未注册：500 且带修复提示", async () => {
    class Orphan {
      a: number = 0;
    }
    const app = host();
    const api = createApi("x.ts");
    api.post("/orphan", Orphan, (ctx) => ctx.json({ ok: true }));
    app.route("/", api);

    const res = await app.request("/orphan", json({}));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("没有为 Orphan 注册 schema");
  });

  test("组内 handler 抛错时父 onError 收得到（Proxy 只绑原型方法）", async () => {
    const app = host();
    let seen = "";
    app.onError((error, ctx) => {
      seen = String(error);
      return ctx.text("caught", 500);
    });
    const api = createApi("x.ts");
    api.get("/boom", () => {
      throw new Error("boom");
    });
    app.route("/", api);

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(seen).toContain("boom");
  });

  test("一条路径挂多个 handler：全部都登记（不能悄悄丢第三个）", async () => {
    const app = host();
    const api = createApi("chain.ts");
    const trace: string[] = [];
    const mw: Handler<HonoxEnv> = async (_ctx, next) => {
      trace.push("mw");
      await next();
    };
    api.get("/many", mw, mw, (ctx) => ctx.json({ ok: true }));
    app.route("/", api);

    const res = await app.request("/many");

    expect(res.status).toBe(200);
    expect(trace).toEqual(["mw", "mw"]);
  });

  test("function 声明当第二个参数时不会被当成模型", async () => {
    const app = host();
    const api = createApi("fn.ts");
    const middleware: Handler<HonoxEnv> = (_ctx, next) => next();
    api.get("/fn", middleware, (ctx) => ctx.json({ ok: true }));
    app.route("/", api);

    const res = await app.request("/fn");

    expect(res.status).toBe(200);
  });

  test("模型出现在 handler 位置：注册时就报错，而不是运行期 500", () => {
    const api = createApi("bad.ts");
    expect(() => {
      (api.get as unknown as (path: string, ...rest: unknown[]) => void)("/bad", BotsQuery, () => new Response(null), () => new Response(null));
    }).toThrow(/只支持 \(path, Model, handler\)/);
  });

  test("use / route 链式之后仍然包装：后续登记的路由不会丢 module", async () => {
    const records: LogRecord[] = [];
    const logger = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
    const app = new Hono<HonoxEnv>();
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "r1");
      ctx.set("uid", null);
      ctx.set("logger", logger);
      await next();
    });
    const api = createApi("u.ts");
    const mw: Handler<HonoxEnv> = async (_ctx, next) => {
      await next();
    };
    api.use("/u", mw).get("/u", (ctx) => {
      traceOf(ctx).info({ hit: 1 });
      return ctx.json({ ok: true });
    });
    app.route("/", api);

    await app.request("/u");

    expect(records[0]?.module).toBe("u.ts");
  });

  test("all 不支持带模型的写法：注册时就报错", () => {
    const api = createApi("all.ts");
    expect(() => {
      (api.all as unknown as (p: string, m: unknown, h: unknown) => void)("/x", BotsBody, () =>
        new Response(null),
      );
    }).toThrow(/all 会按 body 解析/);
  });

  test("options / query 也走同一套包装（Hono 的 METHODS 里都有）", async () => {
    const app = host();
    const api = createApi("probe.ts");
    api.options("/probe", (ctx) => ctx.text("ok"));
    app.route("/", api);

    expect(await (await app.request("/probe", { method: "OPTIONS" })).text()).toBe("ok");
  });

  test("链式登记：返回的是代理，后续调用照样带上 module", async () => {
    const app = host();
    const seen: Array<string | undefined> = [];
    const api = createApi("chain.ts")
      .get("/a", (ctx) => {
        seen.push(ctx.get("api")?.module);
        return ctx.json({ a: 1 });
      })
      .get("/b", (ctx) => {
        seen.push(ctx.get("api")?.module);
        return ctx.json({ b: 2 });
      });
    app.route("/", api);

    expect(await (await app.request("/a")).json()).toEqual({ a: 1 });
    expect(await (await app.request("/b")).json()).toEqual({ b: 2 });
    expect(seen).toEqual(["chain.ts", "chain.ts"]);
  });
});
