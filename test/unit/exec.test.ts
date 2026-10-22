import { describe, expect, test } from "bun:test";

import { createConsoleSource } from "../../src/console/source.js";
import { createExecHandler } from "../../src/console/exec.js";
import { createLogger } from "../../src/core/logger.js";

function setup(timeoutMs = 20) {
  const logger = createLogger({ flushIntervalMs: 0, batch: false });
  const source = createConsoleSource({
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
    expect(await res.json()).toEqual({ ok: true, output: { kind: "text", text: "hello" } });
  });

  test("受限命令无 token 返回 401", async () => {
    const res = await setup()(post(JSON.stringify({ line: "top" })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
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

  test("未知命令返回 200 + 错误文本", async () => {
    const res = await setup()(post(JSON.stringify({ line: "nope" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "unknown command: nope" });
  });

  test("普通异常只回 message", async () => {
    const res = await setup()(post(JSON.stringify({ line: "fail" })));
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Error: detail");
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

  test("超时返回 timeout", async () => {
    const res = await setup()(post(JSON.stringify({ line: "hang" })));
    expect(await res.json()).toEqual({ ok: false, error: "timeout" });
  });
});
