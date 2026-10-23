import { describe, expect, test } from "bun:test";

import { createShell } from "../../src/shell/index.js";
import { newLogger } from "../../src/logo/logo.js";
import { TEST_VERSION } from "../fixtures.js";

function setup(basePath?: string) {
  const logger = newLogger({ flushIntervalMs: 0, batch: false });
  const shell_ = createShell({
    logger,
    auth: { users: { admin: "secret" }, secret: "unit-test-secret" },
    version: TEST_VERSION,
    ...(basePath === undefined ? {} : { basePath }),
  });
  return { logger, shell: shell_ };
}

const get = (path: string, token?: string): Request =>
  new Request(`http://x${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

const post = (path: string, body: unknown, token?: string): Request =>
  new Request(`http://x${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

describe("createShell", () => {
  test("根路径返回页面", async () => {
    const { shell: api } = setup();
    const res = await api.handler(get("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    // 静态托管的默认入口别名
    expect((await api.handler(get("/index.html"))).status).toBe(200);
  });

  test("auth 路由换 token：错口令 401，对口令拿到 token", async () => {
    const { shell: api } = setup();

    const bad = await api.handler(post("/auth", { user: "admin", password: "wrong" }));
    expect(bad.status).toBe(401);

    const good = await api.handler(post("/auth", { user: "admin", password: "secret" }));
    const body = (await good.json()) as { token?: string };
    expect(typeof body.token).toBe("string");
  });

  test("health 返回 ok", async () => {
    const { shell: api } = setup();
    const res = await api.handler(get("/health"));
    expect(await res.json()).toEqual({ ok: true });
  });

  test("events 不带 token 返回 401", async () => {
    const { shell: api } = setup();
    expect((await api.handler(get("/events"))).status).toBe(401);
  });

  test("events 带有效 token 返回事件流", async () => {
    const { shell: api } = setup();
    const token = (await api.source.auth.login("admin", "secret")) as string;

    const res = await api.handler(get("/events", token));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body?.cancel();
  });

  test("exec 接线可用：公开命令不需要 token", async () => {
    const { shell: api } = setup();
    const res = await api.handler(post("/exec", { line: "help" }));
    expect(res.status).toBe(200);
    // 序列化走平台内置的 Response.json；Bun 会额外带 charset，只断言主类型。
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as { data?: unknown }).data).toBeDefined();
  });

  test("exec 受限命令需要 token", async () => {
    const { shell: api } = setup();
    expect((await api.handler(post("/exec", { line: "top" }))).status).toBe(401);

    const token = (await api.source.auth.login("admin", "secret")) as string;
    expect((await api.handler(post("/exec", { line: "top" }, token))).status).toBe(200);
  });

  test("basePath 生效，其它路径 404", async () => {
    const { shell: api } = setup("/dbg");
    expect((await api.handler(get("/dbg"))).status).toBe(200);
    expect((await api.handler(get("/dbg/"))).status).toBe(200);
    expect((await api.handler(get("/dbg/health"))).status).toBe(200);
    expect((await api.handler(get("/"))).status).toBe(404);
    expect((await api.handler(get("/health"))).status).toBe(404);
  });

  test("log.list 列出日志文件，/log 路由能取全文", async () => {
    const logger = newLogger({ flushIntervalMs: 0, batch: false });
    const files: Record<string, string> = { "info.log": '{"msg":"line1"}\n' };
    const api = createShell({
      logger,
      auth: { users: { admin: "secret" }, secret: "unit-test-secret" },
      basePath: "/shell",
      logFiles: {
        list: async () => [{ name: "info.log", size: 18, modified: 1_700_000_000_000 }],
        read: async (name) => files[name] ?? null,
      },
    });

    const token = (await api.source.auth.login("admin", "secret")) as string;
    const res = await api.handler(post("/shell/exec", { line: "log.list" }, token));
    const body = (await res.json()) as {
      data: { rows: Array<Array<{ text: string; href: string } | number | string>> };
    };
    const cell = body.data.rows[0]?.[0] as { text: string; href: string };
    expect(cell.text).toBe("info.log");

    // 带 Authorization 头能取全文
    expect((await api.handler(get(cell.href, token))).status).toBe(200);

    // 没有头 401，名字不存在 404
    expect((await api.handler(get("/shell/log/info.log"))).status).toBe(401);
    expect((await api.handler(get("/shell/log/nope.log", token))).status).toBe(404);

    api.dispose();
  });

  test("dispose 之后返回 503 并摘掉 sink", async () => {
    const { logger, shell: api } = setup();
    api.dispose();

    expect((await api.handler(post("/exec", { line: "help" }))).status).toBe(503);

    logger.info("after");
    logger.flush();
    // dispose 之后不会再往任何连接推；用 broadcast 的连接数近似验证已摘干净。
    expect(api.source.broadcast.count()).toBe(0);
  });

  test("未知路径 404，message 能定位到是哪条请求没命中", async () => {
    const { shell: api } = setup();
    const res = await api.handler(get("/nope"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    // message 必须带方法与路径，只回 "not found" 等于没回
    expect(body.message).toContain("GET");
    expect(body.message).toContain("/nope");
  });
});
