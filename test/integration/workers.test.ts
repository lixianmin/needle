import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

let mf: Miniflare;
let bundle: string;

beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: ["test/workers/entry.ts"],
    target: "browser",
    format: "esm",
  });

  if (!result.success) {
    throw new Error(result.logs.map(String).join("\n"));
  }

  const output = result.outputs[0];
  if (output === undefined) {
    throw new Error("没有构建产物");
  }
  bundle = await output.text();

  mf = new Miniflare({
    modules: true,
    script: bundle,
    compatibilityDate: "2026-08-06",
  });
});

afterAll(async () => {
  await mf?.dispose();
});

describe("Cloudflare Workers 兼容性", () => {
  test("打包产物里没有静态 node: 模块、也没有动态 import()", () => {
    expect(bundle).not.toContain('from "node:');
    expect(bundle).not.toContain("require(");
    // workerd 不接受非字面量的模块说明符，运行到就是 ERR_MODULE_DYNAMIC_SPEC。
    expect(bundle).not.toContain("import(");
  });

  test("页面能返回，且是 Solarized 的底色", async () => {
    const res = await mf.dispatchFetch("http://x/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("#002b36");
  });

  test("公开命令可执行", async () => {
    const res = await mf.dispatchFetch("http://x/exec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ line: "help" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data?: unknown }).data).toBeDefined();
  });

  test("登录后 ps 报 workers 运行时（没有 perf_hooks）", async () => {
    const login = await mf.dispatchFetch("http://x/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "admin", password: "secret" }),
    });
    const token = ((await login.json()) as { token: string }).token;

    const res = await mf.dispatchFetch("http://x/exec", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ line: "top" }),
    });
    const body = (await res.json()) as { data: { rows: Array<[string, string]> } };
    const runtime = body.data.rows.find(([key]) => key === "runtime");
    expect(runtime?.[1]).toBe("workers");
  });

  test("事件流需要 token，带上后返回 SSE", async () => {
    const unauthorized = await mf.dispatchFetch("http://x/events");
    expect(unauthorized.status).toBe(401);

    const login = await mf.dispatchFetch("http://x/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "admin", password: "secret" }),
    });
    const token = ((await login.json()) as { token: string }).token;

    const res = await mf.dispatchFetch("http://x/events", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body?.cancel();
  });
});
