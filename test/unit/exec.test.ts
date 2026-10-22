import { describe, expect, test } from "bun:test";

import type { Auth } from "../../src/console/auth.js";
import { CommandError } from "../../src/console/commands.js";
import { createExecHandler } from "../../src/console/exec.js";
import type { Command } from "../../src/console/types.js";
import { createLogger } from "../../src/core/logger.js";

const auth: Auth = {
  login: async () => null,
  verify: async (token) => (token === "good" ? { sub: "admin" } : null),
};

const log = createLogger({ flushIntervalMs: 0, batch: false });

const commands: Command[] = [
  { name: "hi", note: "公开", public: true, run: () => ({ kind: "text", text: "hello" }) },
  { name: "secret", note: "受限", run: () => ({ kind: "text", text: "classified" }) },
  {
    name: "fail",
    note: "抛 CommandError",
    public: true,
    run: () => {
      throw new CommandError("boom");
    },
  },
  {
    name: "crash",
    note: "抛普通错误",
    public: true,
    run: () => {
      throw new Error("secret detail");
    },
  },
  { name: "hang", note: "永不返回", public: true, run: () => new Promise<never>(() => {}) },
];

function post(body: string, token?: string): Request {
  return new Request("http://x/exec", {
    method: "POST",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body,
  });
}

const exec = createExecHandler({ commands, auth, log, timeoutMs: 20 });

describe("/exec", () => {
  test("公开命令无需 token", async () => {
    const res = await exec(post(JSON.stringify({ line: "hi" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, output: { kind: "text", text: "hello" } });
  });

  test("受限命令无 token 返回 401", async () => {
    const res = await exec(post(JSON.stringify({ line: "secret" })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  test("受限命令带有效 token 可执行", async () => {
    const res = await exec(post(JSON.stringify({ line: "secret" }), "good"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test("垃圾 token 返回 401 而不是 500", async () => {
    const res = await exec(post(JSON.stringify({ line: "secret" }), "garbage"));
    expect(res.status).toBe(401);
  });

  test("未知命令返回 200 + 错误文本", async () => {
    const res = await exec(post(JSON.stringify({ line: "nope" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "unknown command: nope" });
  });

  test("CommandError 的消息原样返回", async () => {
    const res = await exec(post(JSON.stringify({ line: "fail" })));
    expect(await res.json()).toEqual({ ok: false, error: "boom" });
  });

  test("普通异常只回 message，不带堆栈", async () => {
    const res = await exec(post(JSON.stringify({ line: "crash" })));
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("Error: secret detail");
    expect(body.error).not.toContain("at ");
  });

  test("非 JSON body 返回 400", async () => {
    const res = await exec(post("not json"));
    expect(res.status).toBe(400);
  });

  test("超大 body 返回 413", async () => {
    const res = await exec(post(JSON.stringify({ line: "hi", pad: "x".repeat(5000) })));
    expect(res.status).toBe(413);
  });

  test("line 不是字符串返回 400", async () => {
    const res = await exec(post(JSON.stringify({ line: 42 })));
    expect(res.status).toBe(400);
  });

  test("空命令返回 400", async () => {
    const res = await exec(post(JSON.stringify({ line: "   " })));
    expect(res.status).toBe(400);
  });

  test("超时返回 timeout 且不挂起", async () => {
    const res = await exec(post(JSON.stringify({ line: "hang" })));
    expect(await res.json()).toEqual({ ok: false, error: "timeout" });
  });
});
