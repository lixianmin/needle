import { describe, expect, test } from "bun:test";

import { createAuth } from "../../src/shell/auth.js";
import { createAuthRoute } from "../../src/shell/authenticate.js";
import { createShellSource } from "../../src/shell/source.js";
import { newLogger } from "../../src/logo/logo.js";

const options = { users: { admin: "secret" }, secret: "unit-test-secret" } as const;

describe("createAuth", () => {
  test("密码正确时签发可验证的 token", async () => {
    const auth = createAuth({ ...options, now: () => 1000 });
    const token = await auth.login("admin", "secret");

    expect(token).toBeString();
    expect(await auth.verify(token)).toEqual({ sub: "admin" });
  });

  test("密码错误返回 null", async () => {
    const auth = createAuth(options);
    expect(await auth.login("admin", "nope")).toBeNull();
  });

  test("不存在的用户返回 null", async () => {
    const auth = createAuth(options);
    expect(await auth.login("ghost", "secret")).toBeNull();
  });

  test("过期 token 验不过", async () => {
    let clock = 1000;
    const auth = createAuth({ ...options, ttlMs: 500, now: () => clock });
    const token = await auth.login("admin", "secret");

    clock = 1600;
    expect(await auth.verify(token)).toBeNull();
  });

  test("篡改 payload 验不过", async () => {
    const auth = createAuth(options);
    const token = (await auth.login("admin", "secret")) as string;
    const [payload, signature] = token.split(".") as [string, string];
    const tampered = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${signature}`;

    expect(await auth.verify(tampered)).toBeNull();
  });

  test("垃圾输入返回 null 而不抛", async () => {
    const auth = createAuth(options);
    for (const input of ["", "a.b", "!!!", "!!!.???", null]) {
      expect(await auth.verify(input)).toBeNull();
    }
  });

  test("换 secret 签的 token 验不过", async () => {
    const first = createAuth({ users: { admin: "secret" }, secret: "one" });
    const second = createAuth({ users: { admin: "secret" }, secret: "two" });
    const token = await first.login("admin", "secret");

    expect(await second.verify(token)).toBeNull();
  });

  test("没传 secret 时不抛，登录仍然可用", async () => {
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const auth = createAuth({ users: { admin: "secret" } });
      const token = await auth.login("admin", "secret");
      expect(await auth.verify(token)).toEqual({ sub: "admin" });
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("/auth 请求体上限", () => {
  test("chunked 请求不带 content-length 也挡得住", async () => {
    const source = createShellSource({
      logger: newLogger({ flushIntervalMs: 0, batch: false }),
      auth: { users: { admin: "secret" }, secret: "unit-test-secret" },
    });
    const handler = createAuthRoute({ source });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(2000)));
        controller.close();
      },
    });
    const res = await handler(new Request("http://x/auth", { method: "POST", body, duplex: "half" } as RequestInit));

    expect(res.status).toBe(413);
  });
});

describe("配置校验", () => {
  test("空 secret 在构造时就报错", () => {
    expect(() => createAuth({ users: { admin: "secret" }, secret: "" })).toThrow(/secret/);
  });
});
