import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";

import { attach } from "../../src/node/index.js";

/** 假控制台：只要一个 (Request) => Response，够 attach 用。 */
function fakeConsole() {
  return {
    handler: async (req: Request) => new Response(`console:${new URL(req.url).pathname}`),
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
  });
}

describe("attach", () => {
  test("已有 server：/console 交给控制台，其余交回原 handler", async () => {
    const server = createServer((_req, res) => res.end("app"));
    attach(server, fakeConsole(), { basePath: "/console" });
    const port = await listen(server);
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/other`)).text()).toBe("app");
      expect(await (await fetch(`http://127.0.0.1:${port}/console`)).text()).toBe("console:/console");
      expect(await (await fetch(`http://127.0.0.1:${port}/console/x?y=1`)).text()).toBe(
        "console:/console/x",
      );
    } finally {
      await close(server);
    }
  });

  test("前缀按段匹配：/consolefoo 不算控制台", async () => {
    const server = createServer((_req, res) => res.end("app"));
    attach(server, fakeConsole(), { basePath: "/console" });
    const port = await listen(server);
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/consolefoo`)).text()).toBe("app");
    } finally {
      await close(server);
    }
  });

  test("省略 basePath 时接管全部请求", async () => {
    const server = createServer((_req, res) => res.end("app"));
    attach(server, fakeConsole());
    const port = await listen(server);
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}/anything`)).text()).toBe(
        "console:/anything",
      );
    } finally {
      await close(server);
    }
  });

  test("没有原 handler 时，前缀外的请求返回 404 而不是挂起", async () => {
    const server = createServer();
    attach(server, fakeConsole(), { basePath: "/console" });
    const port = await listen(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/other`);
      expect(response.status).toBe(404);
      await response.text();
    } finally {
      await close(server);
    }
  });

  test("POST 的 body 能完整到达控制台 handler", async () => {
    const server = createServer((_req, res) => res.end("app"));
    attach(
      server,
      { handler: async (req: Request) => Response.json({ body: await req.text() }) },
      { basePath: "/console" },
    );
    const port = await listen(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/console/exec`, {
        method: "POST",
        body: "top",
      });
      expect(await response.json()).toEqual({ body: "top" });
    } finally {
      await close(server);
    }
  });
});
