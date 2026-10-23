import { describe, expect, test } from "bun:test";

import { createShellSource } from "../../packages/shell/src/source.js";
import { createExecHandler } from "../../packages/shell/src/exec.js";
import { newLogger } from "../../packages/logo/src/logo/logo.js";

function setup(timeoutMs = 20) {
  const logger = newLogger({ flushIntervalMs: 0, batch: false });
  const source = createShellSource({
    logger,
    auth: { users: { admin: "secret" }, secret: "s3cret" },
    commands: [
      { name: "hi", note: "公开", public: true, run: () => ({ kind: "text", text: "hello" }) },
      { name: "hang", note: "永不返回", public: true, run: () => new Promise<never>(() => {}) },
      {
        name: "fail",
        note: "抛错",
        public: true,
        run: () => {
          throw new Error("detail");
        },
      },
    ],
    timeoutMs,
  });
  return createExecHandler({ source });
}

function post(body: string, token?: string): Request {
  return new Request("http://x/exec", {
    method: "POST",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body,
  });
}

describe("/exec 适配器", () => {
  test("公开命令无需 token", async () => {
    const res = await setup()(post(JSON.stringify({ line: "hi" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ output: { kind: "text", text: "hello" } });
  });

  test("受限命令无 token 返回 401", async () => {
    const res = await setup()(post(JSON.stringify({ line: "top" })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "unauthorized" });
  });

  test("垃圾 token 返回 401 而不是 500", async () => {
    const res = await setup()(post(JSON.stringify({ line: "top" }), "garbage"));
    expect(res.status).toBe(401);
  });

  test("无效 token 无法执行受限命令（伪造 payload）", async () => {
    const forged = `${btoa('{"sub":"admin","exp":9999999999999}')}.AAAA`;
    const res = await setup()(post(JSON.stringify({ line: "top" }), forged));
    expect(res.status).toBe(401);
  });

  test("未知命令返回 400 + bad_request", async () => {
    const res = await setup()(post(JSON.stringify({ line: "nope" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "unknown command: nope" });
  });

  test("普通异常只回 message", async () => {
    const res = await setup()(post(JSON.stringify({ line: "fail" })));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal_error", message: "Error: detail" });
  });

  test("非 JSON body 返回 400", async () => {
    expect((await setup()(post("not json"))).status).toBe(400);
  });

  test("声明长度超限时不必读完 body 就返回 413", async () => {
    const res = await setup()(
      new Request("http://x/exec", {
        method: "POST",
        headers: { "content-length": "999999" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
  });

  test("超大 body 返回 413", async () => {
    const res = await setup()(post(JSON.stringify({ line: "hi", pad: "x".repeat(5000) })));
    expect(res.status).toBe(413);
  });

  test("line 不是字符串返回 400", async () => {
    expect((await setup()(post(JSON.stringify({ line: 42 })))).status).toBe(400);
  });

  test("空命令返回 400", async () => {
    expect((await setup()(post(JSON.stringify({ line: "  " })))).status).toBe(400);
  });

  test("超时返回 504 + gateway_timeout", async () => {
    const res = await setup()(post(JSON.stringify({ line: "hang" })));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ code: "gateway_timeout", message: "timeout" });
  });
});

describe("请求体上限", () => {
  test("chunked 请求不带 content-length 也挡得住", async () => {
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

    const res = await setup()(req);
    expect(res.status).toBe(413);
  });
});
