import { describe, expect, test } from "bun:test";
import { newLogger } from "../../src/core/logo/index.js";
import { createConsole } from "../../src/console/index.js";
import { mountConsole, serveHono } from "../../src/hono/index.js";

/** 最小的 Hono 替身：只记下注册了哪些路径，并能按路径取回 handler。 */
function fakeApp() {
  const routes = new Map<string, (c: { req: { raw: Request } }) => Promise<Response>>();
  return {
    routes,
    all(path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) {
      routes.set(path, handler);
    },
    async fetch(req: Request): Promise<Response> {
      const path = new URL(req.url).pathname;
      for (const [pattern, handler] of routes) {
        if (matchPattern(pattern, path)) return handler({ req: { raw: req } });
      }
      return new Response("not found", { status: 404 });
    },
  };
}

function matchPattern(pattern: string, path: string): boolean {
  if (pattern.endsWith("/*")) return path.startsWith(pattern.slice(0, -2));
  return path === pattern;
}

function makeConsole(user?: string) {
  return createConsole({
    logger: newLogger({}),
    auth: { users: { xmli: "pw" }, secret: "s" },
    title: "t",
    basePath: "/console",
    ...(user === undefined ? {} : { user }),
  });
}

describe("mountConsole", () => {
  test("把控制台挂到 basePath 与 basePath/* 两条路径上", () => {
    const app = fakeApp();
    mountConsole(app as never, makeConsole(), { basePath: "/console" });
    expect([...app.routes.keys()].sort()).toEqual(["/console", "/console/*"]);
  });

  test("经 Hono 能打开控制台页面", async () => {
    const app = fakeApp();
    mountConsole(app as never, makeConsole(), { basePath: "/console" });
    const res = await app.fetch(new Request("http://x/console/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("没有 basePath 时挂到根路径", () => {
    const app = fakeApp();
    mountConsole(app as never, makeConsole());
    expect([...app.routes.keys()].sort()).toEqual(["/", "/*"]);
  });
});

describe("serveHono", () => {
  test("把 app.fetch 接到真实端口上", async () => {
    const app = fakeApp();
    mountConsole(app as never, makeConsole(), { basePath: "/console" });
    const running = await serveHono(app as never, { port: 0, hostname: "127.0.0.1" });
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/console/health`);
      expect(res.status).toBe(200);
    } finally {
      await running.close();
    }
  });
});

describe("本地模式（user 已设）", () => {
  test("不用 token 就能读日志文件", async () => {
    const app = fakeApp();
    const console = createConsole({
      logger: newLogger({}),
      auth: { users: { xmli: "pw" }, secret: "s" },
      basePath: "/console",
      user: "local",
      logFiles: {
        list: async () => [],
        read: async (name: string) => (name === "info.log" ? "hello" : null),
      },
    });
    mountConsole(app as never, console, { basePath: "/console" });
    const res = await app.fetch(new Request("http://x/console/log/info.log"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("没设 user 时，读日志仍然要 token", async () => {
    const app = fakeApp();
    const console = createConsole({
      logger: newLogger({}),
      auth: { users: { xmli: "pw" }, secret: "s" },
      basePath: "/console",
      logFiles: { list: async () => [], read: async () => "secret" },
    });
    mountConsole(app as never, console, { basePath: "/console" });
    const res = await app.fetch(new Request("http://x/console/log/info.log"));
    expect(res.status).toBe(401);
  });
});
