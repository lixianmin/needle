import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { newLogger } from "@needle/logo";
import { sign } from "hono/jwt";
import { createAuthGuard, matchesPublic } from "../src/auth.js";
import type { HonoxEnv, PublicEntry } from "../src/types.js";

const SECRET = "test-secret";

async function token(claims: Record<string, unknown>, secret = SECRET): Promise<string> {
  return sign(claims, secret, "HS256");
}

function appWith(
  publicEntries: readonly PublicEntry[],
  extra: { claim?: string; cookie?: string } = {},
) {
  const app = new Hono<HonoxEnv>();
  const logger = newLogger({ sinks: [], batch: false });
  app.use("*", createAuthGuard({ secret: SECRET, ...extra }, publicEntries, logger));
  app.get("/me", (ctx) => ctx.json({ uid: ctx.get("uid"), err: ctx.get("authError") }));
  app.get("/health", (ctx) => ctx.text("ok"));
  app.post("/login", (ctx) => ctx.text("in"));
  app.get("/users/:id", (ctx) => ctx.text("user"));
  app.get("/assets", (ctx) => ctx.text("assets"));
  app.get("/assets/path", (ctx) => ctx.text("asset"));
  app.get("/assets/*", (ctx) => ctx.text("asset-deep"));
  return app;
}

describe("matchesPublic", () => {
  test("精确、方法限定、命名段、尾通配、query 串", () => {
    expect(matchesPublic(["/health"], "GET", "/health")).toBe(true);
    expect(matchesPublic(["/health"], "POST", "/health")).toBe(true);
    expect(matchesPublic([{ method: "POST", path: "/login" }], "GET", "/login")).toBe(false);
    expect(matchesPublic(["/users/:id"], "GET", "/users/9")).toBe(true);
    expect(matchesPublic(["/users/:id"], "GET", "/users/9/orders")).toBe(false);
    expect(matchesPublic(["/assets/*"], "GET", "/assets")).toBe(true);
    expect(matchesPublic(["/assets/*"], "GET", "/assets/a/b")).toBe(true);
    expect(matchesPublic(["/health"], "GET", "/health?x=1")).toBe(true);
  });
});

describe("createAuthGuard", () => {
  test("有效 token 放行并设置 uid", async () => {
    const res = await appWith([]).request("/me", {
      headers: { authorization: `Bearer ${await token({ sub: "u1" })}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "u1", err: null });
  });

  test("缺 token → 401 unauthorized", async () => {
    const res = await appWith([]).request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  test("签名错 → 401", async () => {
    const res = await appWith([]).request("/me", {
      headers: { authorization: `Bearer ${await token({ sub: "u1" }, "other")}` },
    });
    expect(res.status).toBe(401);
  });

  test("过期 → 401 且 message 提到过期", async () => {
    const expired = await token({ sub: "u1", exp: Math.floor(Date.now() / 1000) - 10 });
    const res = await appWith([]).request("/me", {
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toMatch(/过期/);
  });

  test("sub 不是字符串 → 401", async () => {
    const res = await appWith([]).request("/me", {
      headers: { authorization: `Bearer ${await token({ sub: 42 })}` },
    });
    expect(res.status).toBe(401);
  });

  test("没有 sub → 401", async () => {
    const res = await appWith([]).request("/me", {
      headers: { authorization: `Bearer ${await token({ name: "x" })}` },
    });
    expect(res.status).toBe(401);
  });

  // 三条 message 是客户端唯一能看到的失败原因（authError 只进日志）。
  test("401 的 message 按原因区分：缺 token / 无效 / 过期", async () => {
    const missing = await appWith([]).request("/me");
    expect((await missing.json()).message).toBe("需要登录");

    const invalid = await appWith([]).request("/me", {
      headers: { authorization: "Bearer not-a-token" },
    });
    expect((await invalid.json()).message).toBe("token 无效");

    const expired = await token({ sub: "u1", exp: Math.floor(Date.now() / 1000) - 10 });
    const stale = await appWith([]).request("/me", {
      headers: { authorization: `Bearer ${expired}` },
    });
    expect((await stale.json()).message).toBe("登录已过期");
  });

  test("sub 是空串与不是字符串同罪：401 且 message 是「token 无效」", async () => {
    const res = await appWith([]).request("/me", {
      headers: { authorization: `Bearer ${await token({ sub: "" })}` },
    });

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("token 无效");
  });

  test("authorization 头解析：大小写不敏感、多空格可以、前缀不对要拦", async () => {
    const valid = await token({ sub: "u1" });

    const upper = await appWith([]).request("/me", {
      headers: { authorization: `BEARER ${valid}` },
    });
    expect(await upper.json()).toMatchObject({ uid: "u1" });

    // `\s+` 改成单个空格时，第二个空格会被算进 token，验签失败。
    const spaced = await appWith([]).request("/me", {
      headers: { authorization: `Bearer  ${valid}` },
    });
    expect(await spaced.json()).toMatchObject({ uid: "u1" });

    // 去掉 `^` 的写法会把 "xxbearer …" 也当成 bearer。
    const prefixed = await appWith([]).request("/me", {
      headers: { authorization: `xxbearer ${valid}` },
    });
    expect(prefixed.status).toBe(401);

    // 只有前缀没有凭据：`?.[1]` 去掉会抛 TypeError（500），正解是 401。
    const bare = await appWith([]).request("/me", { headers: { authorization: "Bearer" } });
    expect(bare.status).toBe(401);
  });

  test("401 的日志带 rid 与 authError，没有 rid 就没法跟请求日志对上", async () => {
    const records: Array<Record<string, unknown>> = [];
    const logger = newLogger({
      batch: false,
      flushIntervalMs: 0,
      sinks: [(batch) => records.push(...(batch as unknown as Record<string, unknown>[]))],
    });
    const app = new Hono<HonoxEnv>();
    // rid 平时由 createHonox 的中间件写；这里单独起一个，避免把整条链路拖进来。
    app.use("*", async (ctx, next) => {
      ctx.set("rid", "rid-1");
      await next();
    });
    app.use("*", createAuthGuard({ secret: SECRET }, [], logger));
    app.get("/me", (ctx) => ctx.text("ok"));

    await app.request("/me");

    expect(records[0]).toMatchObject({ status: 401, authError: "missing" });
    expect(records[0]?.rid).toBe("rid-1");
    expect(records[0]?.path).toBe("/me");
  });

  test("claim 可配", async () => {
    const res = await appWith([], { claim: "uid" }).request("/me", {
      headers: { authorization: `Bearer ${await token({ uid: "u9" })}` },
    });
    expect(await res.json()).toMatchObject({ uid: "u9" });
  });

  test("cookie 取 token", async () => {
    const res = await appWith([], { cookie: "token" }).request("/me", {
      headers: { cookie: `token=${await token({ sub: "u3" })}` },
    });
    expect(await res.json()).toMatchObject({ uid: "u3" });
  });

  test("白名单：字符串放行任意方法，对象限定方法", async () => {
    const app = appWith(["/health", { method: "POST", path: "/login" }]);
    expect((await app.request("/health")).status).toBe(200);
    // 没有 POST /health 路由，所以是 404；关键是没被门禁拦成 401
    expect((await app.request("/health", { method: "POST" })).status).not.toBe(401);
    expect((await app.request("/login", { method: "POST" })).status).toBe(200);
    expect((await app.request("/login")).status).toBe(401);
  });

  test("白名单：命名段与尾通配", async () => {
    const app = appWith(["/users/:id", "/assets/*"]);
    expect((await app.request("/users/9")).status).toBe(200);
    expect((await app.request("/users/9/orders")).status).toBe(401);
    expect((await app.request("/users/9/")).status).toBe(401);
    expect((await app.request("/assets")).status).toBe(200);
    expect((await app.request("/assets/a/b")).status).toBe(200);
  });
});
