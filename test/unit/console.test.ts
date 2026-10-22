import { describe, expect, test } from "bun:test";

import { createConsole } from "../../src/console/index.js";
import { createLogger } from "../../src/core/logger.js";

function setup(basePath?: string) {
  const logger = createLogger({ flushIntervalMs: 0, batch: false });
  const console_ = createConsole({
    logger,
    auth: { users: { admin: "secret" }, secret: "unit-test-secret" },
    version: "9.9.9",
    ...(basePath === undefined ? {} : { basePath }),
  });
  return { logger, console: console_ };
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

describe("createConsole", () => {
  test("根路径返回页面", async () => {
    const { console: api } = setup();
    const res = await api.handler(get("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("health 返回 ok", async () => {
    const { console: api } = setup();
    const res = await api.handler(get("/health"));
    expect(await res.json()).toEqual({ ok: true });
  });

  test("events 不带 token 返回 401", async () => {
    const { console: api } = setup();
    expect((await api.handler(get("/events"))).status).toBe(401);
  });

  test("events 带有效 token 返回事件流", async () => {
    const { console: api } = setup();
    const token = (await api.source.auth.login("admin", "secret")) as string;

    const res = await api.handler(get("/events", token));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body?.cancel();
  });

  test("exec 接线可用：公开命令不需要 token", async () => {
    const { console: api } = setup();
    const res = await api.handler(post("/exec", { line: "help" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  test("exec 受限命令需要 token", async () => {
    const { console: api } = setup();
    expect((await api.handler(post("/exec", { line: "top" }))).status).toBe(401);

    const token = (await api.source.auth.login("admin", "secret")) as string;
    expect((await api.handler(post("/exec", { line: "top" }, token))).status).toBe(200);
  });

  test("basePath 生效，其它路径 404", async () => {
    const { console: api } = setup("/dbg");
    expect((await api.handler(get("/dbg"))).status).toBe(200);
    expect((await api.handler(get("/dbg/"))).status).toBe(200);
    expect((await api.handler(get("/dbg/health"))).status).toBe(200);
    expect((await api.handler(get("/"))).status).toBe(404);
    expect((await api.handler(get("/health"))).status).toBe(404);
  });

  test("日志进环形缓冲后能被 logs 命令读到", async () => {
    const { logger, console: api } = setup();
    const token = (await api.source.auth.login("admin", "secret")) as string;

    logger.info("hello");
    logger.flush();

    const res = await api.handler(post("/exec", { line: "logs" }, token));
    const body = (await res.json()) as { output: { rows: unknown[][] } };
    expect(body.output.rows[0]?.[2]).toBe("hello");
  });

  test("dispose 之后返回 503 并摘掉 sink", async () => {
    const { logger, console: api } = setup();
    api.dispose();

    expect((await api.handler(post("/exec", { line: "help" }))).status).toBe(503);

    logger.info("after");
    logger.flush();
    expect(api.source.records.read()).toHaveLength(0);
  });

  test("未知路径 404", async () => {
    const { console: api } = setup();
    expect((await api.handler(get("/nope"))).status).toBe(404);
  });
});
