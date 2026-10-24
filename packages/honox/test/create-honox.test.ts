import { describe, expect, test } from "bun:test";
import { newLogger, type LogRecord } from "@needle/logo";
import { sign } from "hono/jwt";
import { createHonox } from "../src/index.js";
import { apiRoute, createApi } from "../src/route.js";
import { traceOf } from "../src/trace.js";

/** 26 位大写 Crockford：rid 用 ULID，时间在前 48 位（前 10 个字符）。 */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 把前 10 个字符解回毫秒时间戳，验证 rid 里带的时间没写错。 */
function ulidTime(id: string): number {
  let value = 0;
  for (const char of id.slice(0, 10)) {
    value = value * 32 + ULID_ALPHABET.indexOf(char);
  }
  return value;
}

const SECRET = "test-secret";

function setup() {
  const records: LogRecord[] = [];
  const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  const app = createHonox({
    logger: log,
    auth: { secret: SECRET },
    shell: {
      basePath: "/shell",
      user: "local",
      auth: { users: { admin: "pw" } },
      title: "t",
      version: "0.0.0",
    },
  });
  app.allowAnonymous(["/health"]);
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/me", (c) => c.json({ uid: c.get("uid") }));
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

  test("有效 token 时 handler 能读到 uid", async () => {
    const { app } = setup();
    const token = await sign({ sub: "u1" }, SECRET, "HS256");
    const res = await app.request("/me", { headers: { authorization: `Bearer ${token}` } });
    expect(await res.json()).toEqual({ uid: "u1" });
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
      expect(id).toMatch(ULID_PATTERN);
    }
  });

  test("没带 rid 时自己生成：26 位 ULID，时间前缀就是当前时间", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.get("/rid", (c) => c.json({}));
    const before = Date.now();
    const res = await app.request("/rid");
    const rid = res.headers.get("x-rid")!;
    expect(rid).toMatch(ULID_PATTERN);
    // ULID 的时间位是绝对毫秒：能对回当前时间就说明时间位没写错，
    // 而且 rid 不再依赖任何 nodeId 配置（多实例不必互相对号）。
    expect(Math.abs(ulidTime(rid) - before)).toBeLessThan(60_000);
  });

  test("响应头有 x-rid，业务日志里的 rid 与它一致", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/logged"]);
    app.get("/logged", (c) => {
      traceOf(c).info({ note: "hi" });
      return c.json({ ok: true });
    });

    const res = await app.request("/logged");

    const id = res.headers.get("x-rid");
    expect(id).toBeTruthy();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ rid: id, note: "hi", method: "GET", path: "/logged" });
  });

  test("apiRoute：日志里的位置指向 API 注册处，不是中间件那一行", async () => {
    const records: LogRecord[] = [];
    const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
    const app = createHonox({ logger: log, auth: { secret: SECRET } });
    app.allowAnonymous(["/where"]);
    app.get(
      "/where",
      apiRoute("api/where", (c) => {
        traceOf(c, log).info({ note: "where" });
        return c.json({ ok: true });
      }),
    );

    await app.request("/where");

    expect(records).toHaveLength(1);
    expect(records[0]?.module).toBe("api/where");
    expect(records[0]?.site).toMatch(/^create-honox\.test\.ts:\d+$/);
  });

  test("createApi(module)：每条路由各自记住注册位置，日志带 module", async () => {
    const records: LogRecord[] = [];
    const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
    const app = createHonox({ logger: log, auth: { secret: SECRET } });
    app.allowAnonymous(["/one", "/two"]);

    const group = createApi("api/group");
    group.get("/one", (c) => {
      traceOf(c, log).info({ note: "one" });
      return c.json({ ok: 1 });
    });
    group.post("/two", (c) => {
      traceOf(c, log).info({ note: "two" });
      return c.json({ ok: 2 });
    });
    app.route("/", group);

    await app.request("/one");
    const first = records.at(-1);
    await app.request("/two", { method: "POST" });
    const second = records.at(-1);

    expect(first?.module).toBe("api/group");
    expect(second?.module).toBe("api/group");
    expect(first?.site).toMatch(/^create-honox\.test\.ts:\d+$/);
    expect(second?.site).toMatch(/^create-honox\.test\.ts:\d+$/);
    // 两条路由的注册行不同，说明是分别抓的，不是复用第一条
    expect(first?.site).not.toBe(second?.site);
  });

  test("Shell 面板挂到 /shell，且不被门禁拦", async () => {
    const { app } = setup();
    expect((await app.request("/shell")).status).toBe(200);
    expect((await app.request("/shell/")).status).toBe(200);
    // 面板自己的鉴权用 user: "local" 绕过；没配 logFiles 所以 404，但绝不能是门禁的 401
    expect((await app.request("/shell/log/x")).status).toBe(404);
  });

  test("不传 shell 时 /shell 不在白名单，被门禁拦成 401", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    expect((await app.request("/shell")).status).toBe(401);
  });

  test("shell.basePath 为根路径直接报错（否则整站都被白名单放开）", () => {
    expect(() =>
      createHonox({
          auth: { secret: SECRET },
        shell: { basePath: "/", auth: { users: { admin: "pw" } } },
      }),
    ).toThrow(/basePath/);
  });
});

describe("allowAnonymous", () => {
  test("挂载完之后声明，门禁按声明放行；没声明的仍然 401", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.get("/health", (c) => c.json({ ok: true }));
    app.get("/me", (c) => c.json({ uid: c.get("uid") }));
    expect((await app.request("/health")).status).toBe(401);

    app.allowAnonymous(["/health"]);

    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/me")).status).toBe(401);
  });

  test("多次调用是累加，不是覆盖", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.get("/a", (c) => c.text("a"));
    app.get("/b", (c) => c.text("b"));
    app.allowAnonymous(["/a"]);
    app.allowAnonymous(["/b"]);
    expect((await app.request("/a")).status).toBe(200);
    expect((await app.request("/b")).status).toBe(200);
  });

  test("方法限定条目与尾通配都按 8.3 的语义生效", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.post("/login", (c) => c.text("in"));
    app.get("/assets/x", (c) => c.text("asset"));
    app.allowAnonymous([{ method: "POST", path: "/login" }, "/assets/*"]);
    expect((await app.request("/login", { method: "POST" })).status).toBe(200);
    expect((await app.request("/login")).status).toBe(401);
    expect((await app.request("/assets/x")).status).toBe(200);
  });

  test("返回实例本身，可以与 route() 链式接", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.allowAnonymous(["/health"]).get("/health", (c) => c.text("ok"));
    expect((await app.request("/health")).status).toBe(200);
  });

  test("Shell 面板照旧自动放行，不依赖 allowAnonymous", async () => {
    const app = createHonox({
      auth: { secret: SECRET },
      shell: { basePath: "/shell", user: "local", auth: { users: {} }, title: "t", version: "0.0.0" },
    });
    expect((await app.request("/shell")).status).toBe(200);
  });
});
