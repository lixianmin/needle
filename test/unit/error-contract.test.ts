import { describe, expect, test } from "bun:test";

import { createServerShell, type ServerShell } from "../../src/shell/index.js";
import { newLogger } from "../../src/logo/logo.js";
import { ResponseX } from "../../src/core/web/responsex.js";
import { TEST_VERSION } from "../fixtures.js";

/**
 * 错误响应契约（spec §8.2）：失败一律 JSON `{ code, message }`，状态码如实；
 * 成功响应不加壳。这张表是新路由加入时的验收清单——漏了哪条就在这里红。
 */
function setup(): ServerShell {
  const logger = newLogger({ flushIntervalMs: 0, batch: false });
  return createServerShell({
    logger,
    auth: { users: { admin: "secret" }, secret: "error-contract-secret" },
    version: TEST_VERSION,
    timeoutMs: 20,
    logFiles: {
      list: async () => [],
      read: async (name) => (name === "info.log" ? "line\n" : null),
    },
    commands: [
      {
        name: "boom",
        note: "总是抛错",
        run() {
          throw new Error("炸了");
        },
      },
      {
        name: "slow",
        note: "永远不返回",
        run: () => new Promise(() => {}),
      },
    ],
  });
}

function get(path: string, token?: string): Request {
  return new Request(`http://x${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

function post(path: string, body: unknown, token?: string): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("错误响应契约", () => {
  test("每条失败路径都是 { code, message } 的 JSON，且不带 ok", async () => {
    const api = setup();
    const token = (await api.source.auth.login("admin", "secret")) as string;

    const cases: Array<{ name: string; req: Request; status: number; code: string }> = [
      { name: "事件流无 token", req: get("/events"), status: 401, code: "unauthorized" },
      { name: "日志全文无 token", req: get("/log/info.log"), status: 401, code: "unauthorized" },
      { name: "日志文件不存在", req: get("/log/nope.log", token), status: 404, code: "not_found" },
      { name: "未知路径", req: get("/nope"), status: 404, code: "not_found" },
      { name: "方法不匹配", req: post("/health", {}), status: 404, code: "not_found" },
      { name: "未知命令", req: post("/exec", { line: "nope" }), status: 400, code: "bad_request" },
      { name: "空命令", req: post("/exec", { line: "   " }), status: 400, code: "bad_request" },
      { name: "body 不是 JSON", req: post("/exec", "not json"), status: 400, code: "bad_request" },
      { name: "line 不是字符串", req: post("/exec", { line: 42 }), status: 400, code: "bad_request" },
      { name: "命令抛错", req: post("/exec", { line: "boom" }, token), status: 500, code: "internal_error" },
      { name: "命令超时", req: post("/exec", { line: "slow" }, token), status: 504, code: "gateway_timeout" },
      { name: "受限命令无 token", req: post("/exec", { line: "top" }), status: 401, code: "unauthorized" },
      { name: "自定义命令无 token", req: post("/exec", { line: "boom" }), status: 401, code: "unauthorized" },
      { name: "口令错", req: post("/auth", { user: "admin", password: "x" }), status: 401, code: "bad_credentials" },
      { name: "auth body 超长", req: post("/auth", "x".repeat(600)), status: 413, code: "payload_too_large" },
      { name: "exec body 超长", req: post("/exec", "x".repeat(5000)), status: 413, code: "payload_too_large" },
    ];

    for (const item of cases) {
      const res = await api.handler(item.req);
      expect({ name: item.name, status: res.status }).toEqual({ name: item.name, status: item.status });
      expect({ name: item.name, type: res.headers.get("content-type") }).toEqual({
        name: item.name,
        type: expect.stringContaining("application/json"),
      });
      expect({ name: item.name, body: await res.json() }).toEqual({
        name: item.name,
        body: { code: item.code, message: expect.any(String) },
      });
    }

    api.dispose();
  });

  test("dispose 之后是 503 + service_unavailable", async () => {
    const api = setup();
    api.dispose();

    const res = await api.handler(post("/exec", { line: "help" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "service_unavailable", message: expect.any(String) });
  });

  test("成功响应不加壳", async () => {
    const api = setup();

    const exec = await api.handler(post("/exec", { line: "help" }));
    expect(exec.status).toBe(200);
    const body = (await exec.json()) as Record<string, unknown>;
    expect(body.ok).toBeUndefined();
    expect(body.data).toBeDefined();

    const auth = await api.handler(post("/auth", { user: "admin", password: "secret" }));
    expect(auth.status).toBe(200);
    const authBody = (await auth.json()) as Record<string, unknown>;
    expect(authBody.ok).toBeUndefined();
    expect(typeof authBody.token).toBe("string");

    api.dispose();
  });

  test("/health 是探活载荷，不走错误信封", async () => {
    const api = setup();
    const res = await api.handler(get("/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    api.dispose();
  });
});

describe("ResponseX", () => {
  test("具名方法锁死状态码与 code，只收 message", async () => {
    const res = ResponseX.notFound("日志文件不存在");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "日志文件不存在" });
  });

  // 逃生口：8 个具名方法没覆盖的情况（403/429 之类，或某个领域专属 code）。
  test("fail 是逃生口：状态码与 code 由调用方给", async () => {
    const res = ResponseX.fail(403, "forbidden", "没有权限");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "forbidden", message: "没有权限" });
  });
});
