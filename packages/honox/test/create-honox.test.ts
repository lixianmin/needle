import { describe, expect, test } from "bun:test";
import { newLogger, type LogRecord } from "@needle/logo";
import { sign } from "hono/jwt";
import { createHonox } from "../src/index.js";

const SECRET = "test-secret";

function setup() {
  const records: LogRecord[] = [];
  const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  const app = createHonox({
    config: { greeting: "hi" },
    log,
    auth: { secret: SECRET, public: ["/health"] },
    shell: {
      basePath: "/shell",
      user: "local",
      auth: { users: { admin: "pw" } },
      title: "t",
      version: "0.0.0",
    },
  });
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/me", (c) => c.json({ uid: c.get("uid"), greeting: c.get("config").greeting }));
  return { app, records };
}

describe("createHonox", () => {
  test("公开路由不需要 token，受保护路由 401", async () => {
    const { app } = setup();
    expect((await app.request("/health")).status).toBe(200);
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  test("有效 token 时 handler 能读到 uid 与 config", async () => {
    const { app } = setup();
    const token = await sign({ sub: "u1" }, SECRET, "HS256");
    const res = await app.request("/me", { headers: { authorization: `Bearer ${token}` } });
    expect(await res.json()).toEqual({ uid: "u1", greeting: "hi" });
  });

  test("请求自带 x-rid 时沿用，并原样回显", async () => {
    const { app } = setup();
    const res = await app.request("/health", { headers: { "x-rid": "upstream-rid-1" } });
    expect(res.headers.get("x-rid")).toBe("upstream-rid-1");
  });

  test("没有 x-rid 时退回 x-request-id", async () => {
    const { app } = setup();
    const res = await app.request("/health", { headers: { "x-request-id": "gateway-rid" } });
    expect(res.headers.get("x-rid")).toBe("gateway-rid");
  });

  test("入站 rid 含非法字符（空格 / 斜杠 / 超长）时重新生成", async () => {
    // 换行这一类根本构造不出来：Fetch 规范自己就拒收带 CR/LF 的 header。
    // 这里的白名单是第二道防线（别处塞进来的 Request 对象、将来的网关改造）。
    const { app } = setup();
    for (const bad of ["with space", "a/b", "<script>", "x".repeat(65)]) {
      const res = await app.request("/health", { headers: { "x-rid": bad } });
      const id = res.headers.get("x-rid");
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9A-Z]{26}$/);
    }
  });

  test("响应头有 x-rid，且与结束日志的 rid 一致", async () => {
    const { app, records } = setup();
    const res = await app.request("/health");
    const id = res.headers.get("x-rid");
    expect(id).toBeTruthy();
    expect(records.at(-1)).toMatchObject({ msg: "<--", rid: id });
  });

  test("401 也落两条日志", async () => {
    const { app, records } = setup();
    await app.request("/me");
    expect(records.filter((r) => r.msg === "-->")).toHaveLength(1);
    expect(records.filter((r) => r.msg === "<--")).toHaveLength(1);
  });

  test("Shell 面板挂到 /shell，且不被门禁拦", async () => {
    const { app } = setup();
    expect((await app.request("/shell")).status).toBe(200);
    expect((await app.request("/shell/")).status).toBe(200);
    // 面板自己的鉴权用 user: "local" 绕过；没配 logFiles 所以 404，但绝不能是门禁的 401
    expect((await app.request("/shell/log/x")).status).toBe(404);
  });

  test("不传 shell 时 /shell 不在白名单，被门禁拦成 401", async () => {
    const app = createHonox({ config: {}, auth: { secret: SECRET } });
    expect((await app.request("/shell")).status).toBe(401);
  });

  test("shell.basePath 为根路径直接报错（否则整站都被白名单放开）", () => {
    expect(() =>
      createHonox({
        config: {},
        auth: { secret: SECRET },
        shell: { basePath: "/", auth: { users: { admin: "pw" } } },
      }),
    ).toThrow(/basePath/);
  });
});
