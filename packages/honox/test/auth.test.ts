import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { createAuth, matchesPublic } from "../src/auth.js";
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
  app.use("*", createAuth({ secret: SECRET, public: publicEntries, ...extra }));
  app.get("/me", (c) => c.json({ uid: c.get("uid"), err: c.get("authError") }));
  app.get("/health", (c) => c.text("ok"));
  app.post("/login", (c) => c.text("in"));
  app.get("/users/:id", (c) => c.text("user"));
  app.get("/assets", (c) => c.text("assets"));
  app.get("/assets/path", (c) => c.text("asset"));
  app.get("/assets/*", (c) => c.text("asset-deep"));
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

describe("createAuth", () => {
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
