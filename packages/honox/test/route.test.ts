import { beforeEach, describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { clearModels, registerModel } from "../src/model.js";
import { ResponseX } from "@needle/shell";
import { isRequestError } from "../src/request.js";
import { createApi } from "../src/route.js";
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
  app.onError((error, c) => {
    if (isRequestError(error)) {
      return ResponseX.fail(error.status, error.code, error.message);
    }
    return c.text(String(error), 500);
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
    const api = createApi("api/bots");
    api.post("/bots", BotsBody, (c, body) => c.json({ got: body.ids }));
    app.route("/", api);

    const ok = await app.request("/bots", json({ ids: [1, 2] }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ got: [1, 2] });
  });

  test("POST + 模型：body 不合法 → 400", async () => {
    const app = host();
    const api = createApi("api/bots");
    api.post("/bots", BotsBody, (c, body) => c.json({ got: body.ids }));
    app.route("/", api);

    const bad = await app.request("/bots", json({ ids: ["1"] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "bad_request" });
  });

  test("GET + 模型：解析的是 query", async () => {
    const app = host();
    const api = createApi("api/bots");
    api.get("/bots", BotsQuery, (c, query) => c.json({ id: query.id ?? null }));
    app.route("/", api);

    expect(await (await app.request("/bots?id=7")).json()).toEqual({ id: 7 });
  });

  test("不传模型的老写法照旧", async () => {
    const app = host();
    const api = createApi("api/health");
    api.get("/health", (c) => c.json({ ok: true }));
    app.route("/", api);

    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });

  test("模型未注册：500 且带修复提示", async () => {
    class Orphan {
      a: number = 0;
    }
    const app = host();
    const api = createApi("api/x");
    api.post("/orphan", Orphan, (c) => c.json({ ok: true }));
    app.route("/", api);

    const res = await app.request("/orphan", json({}));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("没有为 Orphan 注册 schema");
  });

  test("组内 handler 抛错时父 onError 收得到（Proxy 只绑原型方法）", async () => {
    const app = host();
    let seen = "";
    app.onError((error, c) => {
      seen = String(error);
      return c.text("caught", 500);
    });
    const api = createApi("api/x");
    api.get("/boom", () => {
      throw new Error("boom");
    });
    app.route("/", api);

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(seen).toContain("boom");
  });

  test("链式登记：返回的是代理，后续调用照样抓位置", async () => {
    const app = host();
    const api = createApi("api/chain")
      .get("/a", (c) => c.json({ a: 1 }))
      .get("/b", (c) => c.json({ b: 2 }));
    app.route("/", api);

    expect(await (await app.request("/a")).json()).toEqual({ a: 1 });
    expect(await (await app.request("/b")).json()).toEqual({ b: 2 });
  });
});
