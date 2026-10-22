import { describe, expect, test } from "bun:test";

import { createRouter, normalizeBasePath, type Route } from "../../src/console/router.js";

/** handler 把参数回显成 JSON，方便断言解出了什么。 */
function routes(): Route[] {
  return [
    { method: "GET", pattern: "/", handler: () => new Response("root") },
    { method: "GET", pattern: "/health", handler: () => new Response("health") },
    {
      method: "GET",
      pattern: "/events",
      handler: ({ url }) => new Response(url.searchParams.get("topics") ?? ""),
    },
    {
      method: "GET",
      pattern: "/log/:name",
      handler: ({ params }) => new Response(params.name ?? ""),
    },
    { method: "POST", pattern: "/exec", handler: () => new Response("exec") },
  ];
}

async function hit(router: ReturnType<typeof createRouter>, path: string, method = "GET") {
  const req = new Request(`http://x${path}`, { method });
  const found = router.match(req);
  if (found === null) return null;
  const res = await found.handler({ req, url: found.url, params: found.params });
  return { status: res.status, body: await res.text(), params: found.params };
}

describe("createRouter", () => {
  test("方法 + 路径都匹配才命中", async () => {
    const router = createRouter({ routes: routes() });
    expect(await hit(router, "/health")).toMatchObject({ body: "health" });
    expect(await hit(router, "/health", "POST")).toBeNull();
    expect(await hit(router, "/nope")).toBeNull();
  });

  test("根路径单独处理，不再跟空前缀混淆", async () => {
    const router = createRouter({ routes: routes() });
    expect(await hit(router, "/")).toMatchObject({ body: "root" });
    expect(await hit(router, "/health/")).toBeNull();
  });

  test(":name 解出一个路径段并解码", async () => {
    const router = createRouter({ routes: routes() });
    expect(await hit(router, "/log/info.log")).toMatchObject({
      body: "info.log",
      params: { name: "info.log" },
    });
    expect(await hit(router, "/log/a%20b.log")).toMatchObject({ params: { name: "a b.log" } });
  });

  test("参数只吃一段：多段或空段都不匹配", async () => {
    const router = createRouter({ routes: routes() });
    expect(await hit(router, "/log/a/b")).toBeNull();
    expect(await hit(router, "/log/")).toBeNull();
  });

  test("handler 能拿到 url 的查询串", async () => {
    const router = createRouter({ routes: routes() });
    expect(await hit(router, "/events?topics=top:5000")).toMatchObject({ body: "top:5000" });
  });

  test("basePath 内先剥前缀再匹配，前缀外不匹配", async () => {
    const router = createRouter({ basePath: "/dbg", routes: routes() });
    expect(await hit(router, "/dbg")).toMatchObject({ body: "root" });
    expect(await hit(router, "/dbg/")).toMatchObject({ body: "root" });
    expect(await hit(router, "/dbg/health")).toMatchObject({ body: "health" });
    expect(await hit(router, "/health")).toBeNull();
    // "/dbgx" 只是字符串前缀相同，不能算在挂载点内
    expect(await hit(router, "/dbgx/health")).toBeNull();
  });

  test("命中不到时返回 null，不抛错", () => {
    const router = createRouter({ routes: routes() });
    expect(router.match(new Request("http://x/health", { method: "DELETE" }))).toBeNull();
  });
});

describe("normalizeBasePath", () => {
  test("补前导斜杠、去尾随斜杠，根路径归一成空串", () => {
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("console")).toBe("/console");
    expect(normalizeBasePath("/console/")).toBe("/console");
    expect(normalizeBasePath("/console//")).toBe("/console");
  });
});
