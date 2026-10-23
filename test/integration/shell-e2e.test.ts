import { describe, expect, test } from "bun:test";

import { createShell } from "../../packages/shell/src/index.js";
import { newLogger } from "../../packages/logo/src/logo/logo.js";
import { serve } from "../../packages/shell/src/node.js";
import { TEST_VERSION } from "../fixtures.js";

/**
 * 端到端：真起一个 node:http 服务，走真实 HTTP + SSE。
 *
 * 单测里 shell.handler 是直接调用的，绕过了序列化、分块、连接生命周期。
 * 这个用例证明"装进一个真服务里能用"。
 */
describe("控制台端到端", () => {
  test("登录后能通过 SSE 收到握手与日志帧", async () => {
    const logger = newLogger({ flushIntervalMs: 0, batch: false });
    const shell = createShell({
      logger,
      auth: { users: { admin: "secret" }, secret: "e2e-secret" },
      version: TEST_VERSION,
    });
    const server = await serve(shell.handler, { port: 0 });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      const login = await fetch(`${base}/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "admin", password: "secret" }),
      });
      const token = ((await login.json()) as { token: string }).token;

      const controller = new AbortController();
      const events = await fetch(`${base}/events`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      expect(events.status).toBe(200);

      const reader = events.body?.getReader();
      const decoder = new TextDecoder();
      let text = decoder.decode((await reader?.read())?.value);
      expect(text).toContain("event: handshake");

      logger.info("live-line");
      logger.flush();

      // 读后续帧，直到看到那条日志（最多 50 帧）。
      for (let i = 0; i < 50 && !text.includes("live-line"); i += 1) {
        const chunk = await reader?.read();
        if (chunk?.done === true) break;
        text += decoder.decode(chunk?.value);
      }

      expect(text).toContain("event: log");
      expect(text).toContain("live-line");

      // 不断开的话 server.close() 会等着这条长连接。
      controller.abort();
    } finally {
      await server.close();
      shell.dispose();
    }
  });

  test("密码错误时 /auth 返回 401", async () => {
    const logger = newLogger({ flushIntervalMs: 0, batch: false });
    const shell = createShell({
      logger,
      auth: { users: { admin: "secret" }, secret: "e2e-secret" },
    });
    const server = await serve(shell.handler, { port: 0 });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "admin", password: "nope" }),
      });
      expect(res.status).toBe(401);
    } finally {
      await server.close();
      shell.dispose();
    }
  });

  test("未登录拉事件流被拒", async () => {
    const logger = newLogger({ flushIntervalMs: 0, batch: false });
    const shell = createShell({
      logger,
      auth: { users: { admin: "secret" }, secret: "e2e-secret" },
    });
    const server = await serve(shell.handler, { port: 0 });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/events`);
      expect(res.status).toBe(401);
    } finally {
      await server.close();
      shell.dispose();
    }
  });
});
