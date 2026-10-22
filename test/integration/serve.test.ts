import { describe, expect, test } from "bun:test";

import { serve } from "../../src/node/serve.js";

describe("serve", () => {
  test("把 handler 挂到 node:http 上，返回实际端口", async () => {
    const server = await serve(async () => new Response("hello"), { port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(await res.text()).toBe("hello");
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  test("POST 的 JSON body 能完整到达 handler", async () => {
    const server = await serve(
      async (req) => Response.json(await req.json()),
      { port: 0 },
    );
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: 1 }),
      });
      expect(await res.json()).toEqual({ a: 1 });
    } finally {
      await server.close();
    }
  });

  test("流式响应能完整送达", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("aa"));
        controller.enqueue(new TextEncoder().encode("bb"));
        controller.close();
      },
    });

    const server = await serve(async () => new Response(stream), { port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(await res.text()).toBe("aabb");
    } finally {
      await server.close();
    }
  });

  test("handler 抛错时返回 500 而不是崩掉进程", async () => {
    const server = await serve(async () => {
      throw new Error("boom");
    }, { port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(500);
    } finally {
      await server.close();
    }
  });

  test("close 之后端口不再可连", async () => {
    const server = await serve(async () => new Response("x"), { port: 0 });
    const { port } = server;
    await server.close();

    expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
