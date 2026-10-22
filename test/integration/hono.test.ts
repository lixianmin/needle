import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { newLogger } from "../../src/core/logo/index.js";
import { createConsole } from "../../src/console/index.js";
import { mountConsole, serveHono } from "../../src/hono/index.js";

function setup() {
  const app = new Hono();
  const console = createConsole({
    logger: newLogger({}),
    auth: { users: { xmli: "pw" }, secret: "s" },
    title: "demo",
    basePath: "/console",
    user: "local",
  });
  mountConsole(app, console, { basePath: "/console" });
  app.get("/api/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("真实 Hono 集成", () => {
  test("控制台与业务路由共存", async () => {
    const app = setup();
    const running = await serveHono(app, { port: 0, hostname: "127.0.0.1" });
    try {
      const base = `http://127.0.0.1:${running.port}`;
      expect((await fetch(`${base}/api/ping`)).status).toBe(200);
      const page = await fetch(`${base}/console/`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect((await fetch(`${base}/console/health`)).status).toBe(200);
    } finally {
      await running.close();
    }
  });

  test("Hono 自己处理未知路径（不会被控制台吃掉）", async () => {
    const app = setup();
    const running = await serveHono(app, { port: 0, hostname: "127.0.0.1" });
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/nope`);
      expect(res.status).toBe(404);
    } finally {
      await running.close();
    }
  });
});
