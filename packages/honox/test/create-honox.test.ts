import { describe, expect, test } from "bun:test";
import { formatLine, newLogger, type LogRecord } from "@needle/logo";
import { sign } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createHonox } from "../src/index.js";
import { RequestError } from "../src/request.js";
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
  const logger = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  const app = createHonox({
    logger,
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
  app.get("/health", (ctx) => ctx.json({ ok: true }));
  app.get("/me", (ctx) => ctx.json({ uid: ctx.get("uid") }));
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
    app.get("/rid", (ctx) => ctx.json({}));
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
    app.get("/logged", (ctx) => {
      traceOf(ctx).info({ note: "hi" });
      return ctx.json({ ok: true });
    });

    const res = await app.request("/logged");

    const id = res.headers.get("x-rid");
    expect(id).toBeTruthy();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ rid: id, note: "hi", path: "/logged" });
    expect(records[0]).not.toHaveProperty("method");
  });

  test("apiRoute：日志带 module，模块名进前缀而不是中间件那一行", async () => {
    const records: LogRecord[] = [];
    const logger = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
    const app = createHonox({ logger, auth: { secret: SECRET } });
    app.allowAnonymous(["/where"]);
    app.get(
      "/where",
      apiRoute("where.ts", (ctx) => {
        traceOf(ctx, logger).info({ note: "where" });
        return ctx.json({ ok: true });
      }),
    );

    await app.request("/where");

    expect(records).toHaveLength(1);
    expect(records[0]?.module).toBe("where.ts");
    expect(records[0]?.site).toBeUndefined();
    expect(formatLine(records[0]!)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} \[I\] where\.ts \{/);
    expect(formatLine(records[0]!)).not.toContain('"module"');
  });

  test("createApi(module)：每条路由的日志都带同一个 module", async () => {
    const records: LogRecord[] = [];
    const logger = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
    const app = createHonox({ logger, auth: { secret: SECRET } });
    app.allowAnonymous(["/one", "/two"]);

    const group = createApi("group.ts");
    group.get("/one", (ctx) => {
      traceOf(ctx, logger).info({ note: "one" });
      return ctx.json({ ok: 1 });
    });
    group.post("/two", (ctx) => {
      traceOf(ctx, logger).info({ note: "two" });
      return ctx.json({ ok: 2 });
    });
    app.route("/", group);

    await app.request("/one");
    const first = records.at(-1);
    await app.request("/two", { method: "POST" });
    const second = records.at(-1);

    expect(first?.module).toBe("group.ts");
    expect(second?.module).toBe("group.ts");
    // 注册位置不再进日志：同一个模块的多条路由共用一个 module 前缀
    expect(first?.site).toBeUndefined();
    expect(second?.site).toBeUndefined();
  });

  test("Shell 未命中的路径也记一条 404（这条路径不在 Hono 路由表里）", async () => {
    const { app, records } = setup();

    const res = await app.request("/shell/zzz");

    expect(res.status).toBe(404);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "/shell/zzz", status: 404, level: "info" });
    // rid 必须与响应头一致，否则这条日志没法跟上游/客户端对上
    expect(records[0]?.rid).toBe(res.headers.get("x-rid"));
  });

  test("Shell 命中时不记 404 日志", async () => {
    const { app, records } = setup();

    const res = await app.request("/shell");

    expect(res.status).toBe(200);
    expect(records).toHaveLength(0);
  });

  test("没命中任何路由时 404 的响应体是 {code, message}", async () => {
    const { app, records } = setup();
    app.allowAnonymous(["/nope"]);

    const res = await app.request("/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "接口不存在" });
    // 这条日志是这条路径上唯一的一条，rid 必须对得上响应头
    expect(records).toHaveLength(1);
    expect(records[0]?.rid).toBe(res.headers.get("x-rid"));
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

  test("不传 shell.basePath 时默认 /shell", async () => {
    const app = createHonox({
      auth: { secret: SECRET },
      shell: { user: "local", auth: { users: {} }, title: "t", version: "0.0.0" },
    });
    expect((await app.request("/shell")).status).toBe(200);
  });

  test("basePath 末尾多余的斜杠被收掉", async () => {
    const app = createHonox({
      auth: { secret: SECRET },
      shell: {
        basePath: "/shell//",
        user: "local",
        auth: { users: {} },
        title: "t",
        version: "0.0.0",
      },
    });
    expect((await app.request("/shell")).status).toBe(200);
  });
});

describe("onError", () => {
  /** 路由抛什么由 query 决定，一个 app 跑完整个状态码表。 */
  function boomApp() {
    const app = createHonox({ auth: { secret: SECRET } });
    app.allowAnonymous(["/boom"]);
    app.get("/boom", (ctx) => {
      const status = Number(ctx.req.query("s")) as ContentfulStatusCode;
      throw new HTTPException(status, { message: "boom" });
    });
    return app;
  }

  const STATUS_CODES: readonly (readonly [number, string])[] = [
    [400, "bad_request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [413, "payload_too_large"],
    [422, "unprocessable_entity"],
    [429, "too_many_requests"],
    [500, "internal_error"],
    [503, "service_unavailable"],
    [504, "gateway_timeout"],
    // 表外状态码统一 http_error，别现编
    [418, "http_error"],
  ];

  test("HTTPException 的状态码按表映射成 code；5xx 不回原文", async () => {
    const app = boomApp();
    for (const [status, code] of STATUS_CODES) {
      const res = await app.request(`/boom?s=${status}`);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({
        code,
        message: status >= 500 ? "服务内部错误" : "boom",
      });
    }
  });

  test("HTTPException 自带响应时原样返回，不套信封", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.allowAnonymous(["/raw"]);
    app.get("/raw", () => {
      throw new HTTPException(401, { res: new Response("raw", { status: 401 }) });
    });

    const res = await app.request("/raw");

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("raw");
  });

  test("RequestError 用自己的 status / code / message", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.allowAnonymous(["/conflict"]);
    app.get("/conflict", () => {
      throw new RequestError(409, "conflict", "已经存在");
    });

    const res = await app.request("/conflict");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "已经存在" });
  });

  test("其它异常统一 500 + internal_error，不把内部细节漏给客户端", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.allowAnonymous(["/bang"]);
    app.get("/bang", () => {
      throw new Error("数据库炸了");
    });

    const res = await app.request("/bang");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal_error", message: "服务内部错误" });
  });
});

describe("allowAnonymous", () => {
  test("挂载完之后声明，门禁按声明放行；没声明的仍然 401", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.get("/health", (ctx) => ctx.json({ ok: true }));
    app.get("/me", (ctx) => ctx.json({ uid: ctx.get("uid") }));
    expect((await app.request("/health")).status).toBe(401);

    app.allowAnonymous(["/health"]);

    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/me")).status).toBe(401);
  });

  test("多次调用是累加，不是覆盖", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.get("/a", (ctx) => ctx.text("a"));
    app.get("/b", (ctx) => ctx.text("b"));
    app.allowAnonymous(["/a"]);
    app.allowAnonymous(["/b"]);
    expect((await app.request("/a")).status).toBe(200);
    expect((await app.request("/b")).status).toBe(200);
  });

  test("方法限定条目与尾通配都按 8.3 的语义生效", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.post("/login", (ctx) => ctx.text("in"));
    app.get("/assets/x", (ctx) => ctx.text("asset"));
    app.allowAnonymous([{ method: "POST", path: "/login" }, "/assets/*"]);
    expect((await app.request("/login", { method: "POST" })).status).toBe(200);
    expect((await app.request("/login")).status).toBe(401);
    expect((await app.request("/assets/x")).status).toBe(200);
  });

  test("返回实例本身，可以与 route() 链式接", async () => {
    const app = createHonox({ auth: { secret: SECRET } });
    app.allowAnonymous(["/health"]).get("/health", (ctx) => ctx.text("ok"));
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
