import { describe, expect, test } from "bun:test";

import { createShellSource } from "../src/source.js";
import { createExecHandler } from "../src/exec.js";
import { newLogger } from "@needle/logo";

async function setup(timeoutMs = 20) {
  const logger = newLogger({ flushIntervalMs: 0, batch: false });
  const source = createShellSource({
    logger,
    auth: { users: { admin: "secret" }, secret: "s3cret" },
    commands: [
      { name: "hi", note: "打招呼", run: () => ({ kind: "text", text: "hello" }) },
      { name: "hang", note: "永不返回", run: () => new Promise<never>(() => {}) },
      {
        name: "fail",
        note: "抛错",
        run: () => {
          throw new Error("detail");
        },
      },
    ],
    timeoutMs,
  });
  const token = (await source.auth.login("admin", "secret")) as string;
  return { handler: createExecHandler({ source }), token };
}

function post(body: string, token?: string): Request {
  return new Request("http://x/exec", {
    method: "POST",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body,
  });
}

describe("/exec 适配器", () => {
  test("未登录时 help 可用，只列 auth 与 help", async () => {
    const { handler } = await setup();
    const res = await handler(post(JSON.stringify({ line: "help" })));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { text: string } };
    expect(body.data.text).toContain("auth");
    expect(body.data.text).toContain("help");
    expect(body.data.text).not.toContain("log.list");
    expect(body.data.text).not.toContain("top");
  });

  test("未登录时自定义命令也是 401", async () => {
    const { handler } = await setup();
    const res = await handler(post(JSON.stringify({ line: "hi" })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "unauthorized" });
  });

  test("登录后可以跑自定义命令", async () => {
    const { handler, token } = await setup();
    const res = await handler(post(JSON.stringify({ line: "hi" }), token));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { kind: "text", text: "hello" } });
  });

  test("受限命令无 token 返回 401", async () => {
    const { handler } = await setup();
    const res = await handler(post(JSON.stringify({ line: "top" })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "unauthorized" });
  });

  test("垃圾 token 返回 401 而不是 500", async () => {
    const { handler } = await setup();
    const res = await handler(post(JSON.stringify({ line: "top" }), "garbage"));
    expect(res.status).toBe(401);
  });

  test("无效 token 无法执行命令（伪造 payload）", async () => {
    const { handler } = await setup();
    const forged = `${btoa('{"sub":"admin","exp":9999999999999}')}.AAAA`;
    const res = await handler(post(JSON.stringify({ line: "top" }), forged));
    expect(res.status).toBe(401);
  });

  test("未知命令返回 400 + bad_request", async () => {
    const { handler } = await setup();
    const res = await handler(post(JSON.stringify({ line: "nope" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "unknown command: nope" });
  });

  test("空命令返回 400 + bad_request", async () => {
    const { handler } = await setup();
    const res = await handler(post(JSON.stringify({ line: "   " })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "空命令" });
  });

  test("停机之后 exec 返回 503 + service_unavailable", async () => {
    const source = createShellSource({
      logger: newLogger({ flushIntervalMs: 0, batch: false }),
      auth: { users: { admin: "secret" }, secret: "s3cret" },
    });
    const handler = createExecHandler({ source });
    source.dispose();

    const res = await handler(post(JSON.stringify({ line: "help" })));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "service_unavailable", message: "shell disposed" });
  });

  test("普通异常只回 message", async () => {
    const { handler, token } = await setup();
    const res = await handler(post(JSON.stringify({ line: "fail" }), token));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal_error", message: "Error: detail" });
  });

  test("非 JSON body 返回 400", async () => {
    const { handler } = await setup();
    expect((await handler(post("not json"))).status).toBe(400);
  });

  test("声明长度超限时不必读完 body 就返回 413", async () => {
    const { handler } = await setup();
    const res = await handler(
      new Request("http://x/exec", {
        method: "POST",
        headers: { "content-length": "999999" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
  });

  test("超大 body 返回 413", async () => {
    const { handler } = await setup();
    const res = await handler(post(JSON.stringify({ line: "hi", pad: "x".repeat(5000) })));
    expect(res.status).toBe(413);
  });

  test("line 不是字符串返回 400", async () => {
    const { handler } = await setup();
    expect((await handler(post(JSON.stringify({ line: 42 })))).status).toBe(400);
  });

  test("空命令返回 400", async () => {
    const { handler } = await setup();
    expect((await handler(post(JSON.stringify({ line: "  " })))).status).toBe(400);
  });

  test("超时返回 504 + gateway_timeout", async () => {
    const { handler, token } = await setup();
    const res = await handler(post(JSON.stringify({ line: "hang" }), token));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ code: "gateway_timeout", message: "timeout" });
  });
});

describe("请求体上限", () => {
  test("chunked 请求不带 content-length 也挡得住", async () => {
    const { handler } = await setup();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(5000)));
        controller.close();
      },
    });
    const req = new Request("http://x/exec", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);

    const res = await handler(req);
    expect(res.status).toBe(413);
  });
});
