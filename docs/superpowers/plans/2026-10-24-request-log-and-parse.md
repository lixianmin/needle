# 请求日志提取 + 参数解析 + model 生成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把请求日志从中间件搬到业务手里（`traceOf(ctx)`），参数按 class 模型自动反序列化并校验，模型用 TS class 手写、schema 由脚本生成。

**Architecture:** `logo` 不再为每条日志抓栈（只有 error 带完整栈）；`honox` 删掉 `createRequestLog`，改成「rid + 计时兜底（500/慢请求）+ 鉴权 + 门禁」的链，业务用 `traceOf(ctx)` 打日志；`createApi(module)` 的路由接受 `(path, Model, handler)`，按 HTTP 方法决定解析 query 还是 body，模型到 schema 的映射来自构建期生成的注册表。

**Tech Stack:** TypeScript 7.0.2（项目编译器）、`typescript@6.0.3`（仅生成器用的 AST 解析器，别名 `typescript-6`）、`@sinclair/typebox@0.34`、Hono 4。

**Spec:** `docs/superpowers/specs/2026-10-24-request-log-and-parse-design.md`

## Global Constraints

- 控制流一律带花括号、语句体独占多行，`else` 跟在 `}` 后（`AGENTS.md` 末尾「代码风格」）。
- 单个方法不超过 50 行；magic number 必须注释理由。
- 不做 spec 之外的功能；不顺手重构无关代码。
- 新依赖只有两个：`@sinclair/typebox`（`packages/honox` dependencies）、`typescript-6`（根 devDependencies，`npm:typescript@6.0.3`）。
- 验收命令：`bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs`。
- 每个任务一个 commit；合并前 `packages/honox` / 根 `package.json` 版本号 patch +1 由最后一个任务做。

## Review Focus

- **class 模型改了但没重新生成 schema**：tsc 必须报错（漂移断言），不能跑着一个过期的 schema。
- **`createApi()` 组路由抛错时父 `onError` 是否还收得到**（Proxy 绑定 bug，§3 实测过）。
- **`RequestError` 会不会被记成 error 日志**：客户端传错参数不该产生 error 级日志。
- **query 上的多余参数**（`?_t=123`）不能 400；body 上的多余字段要 400。
- **模型未注册**：报错信息必须指出「先 import app/model/index.js」，而不是 `undefined is not an object`。

---

### Task 1: logo 只在 error 级抓栈

**Files:**
- Modify: `packages/logo/src/logo.ts`（`emit`、`LoggerOptions`、`child`）
- Test: `packages/logo/test/logger.test.ts:175-215`

**Interfaces:**
- Produces: `LoggerOptions` 不再有 `callerDepth`；`captureCallSite(skip?: number): { site: string; fn: string } | undefined` 签名不变。
- Produces: `info` / `warn` / `debug` 的记录里不再有 `site` / `fn` / `stack`；`error` 仍有 `stack`。

- [ ] **Step 1: 改写失败测试**

把 `logger.test.ts:175` 起的「调用点：info / warn / error 都带 site 与 fn」和 `:195` 的 `callerDepth` 两条删掉，换成：

```ts
test("info / warn 不再抓调用点，error 仍有完整栈", () => {
  const records: LogRecord[] = [];
  const log = newLogger({ ...base, sinks: [(batch) => records.push(...batch)], batch: false });
  log.info("a");
  log.warn("b");
  log.error(new Error("boom"));
  // 断言
  expect(records[0]?.site).toBeUndefined();
  expect(records[0]?.stack).toBeUndefined();
  expect(records[1]?.site).toBeUndefined();
  expect(typeof records[2]?.stack).toBe("string");
  expect(records[2]?.stack).toContain("Error: boom");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/logo/test/logger.test.ts`
Expected: FAIL —— `records[0].site` 是 `logger.test.ts:NN`，不是 undefined。

- [ ] **Step 3: 改 `emit`，删 `callerDepth`**

`emit` 里把无条件取帧改成只在需要栈时取：

```ts
const withStack = stackLevel !== "off" && LEVELS[recordLevel] >= LEVELS[stackLevel];
// 调用点不再逐条抓：打包后栈里是 bundle 坐标，付了代价拿不到结果。
// 只有 error 级还要完整栈，那是唯一必须保留的。
const frames = withStack ? externalFrames(0) : undefined;
const built = buildRecord(recordLevel, args, {
  name: options.name,
  stack: frames === undefined ? undefined : stackOf(frames),
  time: now(),
});
```

删 `LoggerOptions.callerDepth`、`buildLogger` 里的 `const callerDepth = …`、`child()` 里的 `callerDepth` 透传；`callSiteOf` / `functionOf` 若无人使用则删除（`captureCallSite` 保留，它自己解析帧）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/logo/test/logger.test.ts && bunx tsc --noEmit`
Expected: PASS，tsc 无输出。

- [ ] **Step 5: Commit**

```bash
git add packages/logo/src/logo.ts packages/logo/test/logger.test.ts packages/logo/dist
git commit -m "perf(logo): 只在 error 级抓栈，info/warn 不再付调用点的代价"
```

---

### Task 2: `traceOf(ctx)`

**Files:**
- Create: `packages/honox/src/trace.ts`
- Test: `packages/honox/test/trace.test.ts`

**Interfaces:**
- Consumes: `Logger` 来自 `@needle/logo`；`HonoxEnv` 来自 `./types.js`。
- Produces: `interface Trace { debug/info/warn/error(...args: unknown[]): void }`；`function traceOf(ctx: Context<HonoxEnv>, log?: Logger): Trace`。
- Produces: 绑定字段 `{ rid, uid, method, path, module?, site?, fn? }`，写在每次调用的第一个参数位置，业务参数在后。

- [ ] **Step 1: 写失败测试**

```ts
test("traceOf 绑定 rid / uid / method / path / module / site，业务字段覆盖同名绑定字段", async () => {
  const records: LogRecord[] = [];
  const log = newLogger({ sinks: [(batch) => records.push(...batch)], batch: false });
  const app = new Hono<HonoxEnv>();
  app.use("*", async (c, next) => {
    c.set("rid", "r1");
    c.set("uid", "u1");
    c.set("api", { module: "api/bots", site: "bots.ts:9", fn: "handler" });
    await next();
  });
  app.post("/bots", (c) => {
    traceOf(c, log).info({ ids: [1] });
    traceOf(c, log).warn({ uid: "override" });
    return c.json({ ok: true });
  });
  await app.request("/bots", { method: "POST" });
  expect(records[0]).toMatchObject({ rid: "r1", uid: "u1", method: "POST", path: "/bots", module: "api/bots", site: "bots.ts:9", fn: "handler", ids: [1], level: "info" });
  expect(records[1]).toMatchObject({ uid: "override", level: "warn" });
});

test("没有 api 上下文时不出 module / site / fn", () => { … });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/honox/test/trace.test.ts`
Expected: FAIL —— 找不到 `trace.ts`。

- [ ] **Step 3: 实现 `traceOf`**

按 Interfaces 里的形状实现：在函数顶部把 `ctx.get("rid")` / `uid` / `req.method` / `req.path` / `ctx.get("api")` 取成 `base`，四个方法各自 `log[level](base, ...args)`。`log` 默认参数用 `logo`。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/honox/test/trace.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/honox/src/trace.ts packages/honox/test/trace.test.ts
git commit -m "feat(honox): 加 traceOf(ctx)，把 rid/uid/method/path/module 绑进日志"
```

---

### Task 3: `RequestError` 与参数解析

**Files:**
- Create: `packages/honox/src/request.ts`、`packages/honox/src/parse.ts`
- Test: `packages/honox/test/parse.test.ts`

**Interfaces:**
- Consumes: `TSchema` / `Static` / `Value` 来自 `@sinclair/typebox`。
- Produces: `class RequestError extends Error`，构造签名 `(message: string)` 与 `(status: number, code: string, message: string)`；`function isRequestError(e: unknown): e is RequestError`。
- Produces: `parseBody<T extends TSchema>(c: Context<HonoxEnv>, schema: T): Promise<Static<T>>`、`parseQuery<T extends TSchema>(c: Context<HonoxEnv>, schema: T): Static<T>`。

- [ ] **Step 1: 写失败测试**

```ts
test("body 合法时返回对象并补默认值；字符串数字被拒", async () => {
  const schema = Type.Object({ ids: Type.Array(Type.Number()), page: Type.Number({ default: 1 }) });
  expect(await body(schema, { ids: [1] })).toMatchObject({ ids: [1], page: 1 });
  await expect(body(schema, { ids: ["1"] })).rejects.toThrow("body /ids/0 Expected number");
});

test("body 不是合法 JSON / 多余字段", async () => {
  await expect(body(Type.Object({}), "not json")).rejects.toThrow("body 不是合法 JSON");
  await expect(raw(Type.Object({ a: Type.Number() }, { additionalProperties: false }), { a: 1, b: 2 })).rejects.toThrow("Unexpected property");
});

test("query 转换字符串数字、空串视为未传、数组收集重复键、多余键忽略", () => {
  const schema = Type.Object({ id: Type.Optional(Type.Number()), ids: Type.Optional(Type.Array(Type.Number())) });
  expect(query(schema, "?id=7&ids=1&ids=2")).toMatchObject({ id: 7, ids: [1, 2] });
  expect(query(schema, "?id=")).toMatchObject({});
  expect(query(schema, "?id=abc")).toThrow;
  expect(query(schema, "?id=1&_t=99")).toMatchObject({ id: 1 });
});

test("RequestError 保留 status/code", () => {
  expect(new RequestError("x")).toMatchObject({ status: 400, code: "bad_request" });
  expect(new RequestError(409, "conflict", "y")).toMatchObject({ status: 409, code: "conflict" });
});

test("body 的 class 实例按字段校验（不做 instanceof）", () => { … });
```

（`body` / `query` / `raw` 是测试里的本地 helper，分别构造 `Context` 调 `parseBody` / `parseQuery`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/honox/test/parse.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `request.ts` 与 `parse.ts`**

`request.ts`：`RequestError`（默认 400 / `bad_request`）+ `isRequestError`。
`parse.ts`：
- `formatErrors(label, errors)` → `body /ids/0 Expected number`（首个 + 其余数量）。
- `parseBody`：`c.req.json()` 失败抛「body 不是合法 JSON」；`typeof parsed === "object"` 时 `Value.Default`；`Value.Errors` 非空抛 `RequestError`。**不 Convert**。
- `parseQuery`：`c.req.queries()` → 只保留 schema 声明的键；空串丢弃；数组键（schema 里 `type === "array"`）收全部值、其余取最后一个；`Value.Convert` → `Value.Default` → `Value.Errors`。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/honox/test/parse.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/honox/src/request.ts packages/honox/src/parse.ts packages/honox/test/parse.test.ts
git commit -m "feat(honox): body/query 解析与 RequestError，失败统一抛 400"
```

---

### Task 4: 模型注册表

**Files:**
- Create: `packages/honox/src/model.ts`
- Test: `packages/honox/test/model.test.ts`

**Interfaces:**
- Produces: `registerModel(name: string, schema: TSchema): void`、`modelSchema(ctor: ModelClass): TSchema`、`type ModelClass<T = unknown> = abstract new (...args: never[]) => T`。
- Produces: 未注册时抛 `Error`，message 含「没有为 BotsBody 注册 schema」与「先 import app/model/index.js」。

- [ ] **Step 1: 写失败测试**

```ts
test("按类名注册与查找", () => {
  class BotsBody { ids: number[] = []; }
  const schema = Type.Object({ ids: Type.Array(Type.Number()) });
  registerModel("BotsBody", schema);
  expect(modelSchema(BotsBody)).toBe(schema);
});

test("没注册时报出类名与修复提示", () => {
  class Unknown { a: number = 0; }
  expect(() => modelSchema(Unknown)).toThrow(/没有为 Unknown 注册 schema/);
  expect(() => modelSchema(Unknown)).toThrow(/app\/model\/index\.js/);
});
```

- [ ] **Step 2: 跑测确认失败** → `bun test packages/honox/test/model.test.ts`
- [ ] **Step 3: 实现**（模块级 `Map<string, TSchema>`）
- [ ] **Step 4: 跑测通过**
- [ ] **Step 5: Commit**

```bash
git add packages/honox/src/model.ts packages/honox/test/model.test.ts
git commit -m "feat(honox): model 注册表，按类名找 schema"
```

---

### Task 5: `createApi(module)` 与 `(path, Model, handler)`

**Files:**
- Modify: `packages/honox/src/route.ts`、`packages/honox/src/types.ts`
- Test: `packages/honox/test/route.test.ts`

**Interfaces:**
- Consumes: `modelSchema`（Task 4）、`parseBody` / `parseQuery`（Task 3）。
- Produces: `createApi(module: string): ApiGroup`；`ApiGroup` 上四个方法各有两种重载：
  `get<T>(path: string, model: ModelClass<T>, handler: (ctx: Context<HonoxEnv>, request: T) => Response | Promise<Response>): ApiGroup` 与 `get(path: string, handler: Handler<HonoxEnv>): ApiGroup`（`post`/`put`/`patch` 同形，`delete` 只解析 query）。
- Produces: `apiRoute(module: string, handler: Handler<HonoxEnv>): Handler<HonoxEnv>`。
- Produces: `HonoxEnv.Variables.api = { module: string; site?: string; fn?: string }`。
- Produces: 注册位置抓取规则不变（`captureCallSite(1)`）。

- [ ] **Step 1: 写失败测试**

```ts
test("POST + 模型：body 解析后作为第二个参数，失败 400", async () => {
  const app = honox();                       // 本地 helper：createHonox + 白名单
  const api = createApi("api/bots");
  api.post("/bots", BotsBody, (c, body) => c.json({ got: body.ids }));
  app.route("/", api);
  const ok = await app.request("/bots", { method: "POST", body: JSON.stringify({ ids: [1, 2] }), headers: { "content-type": "application/json" } });
  expect(await ok.json()).toEqual({ got: [1, 2] });
  const bad = await app.request("/bots", { method: "POST", body: JSON.stringify({ ids: ["1"] }), headers: { "content-type": "application/json" } });
  expect(bad.status).toBe(400);
});

test("GET + 模型：解析的是 query", async () => { … });
test("不传模型的老写法照旧", async () => { … });
test("模型未注册：响应 500，日志里带修复提示", async () => { … });
test("组内 handler 抛错时父 onError 收得到（Proxy 只绑原型方法）", async () => {
  const app = new Hono<HonoxEnv>();
  let seen = "";
  app.onError((error, c) => { seen = String(error); return c.text("x", 500); });
  const api = createApi("api/x");
  api.get("/boom", () => { throw new Error("boom"); });
  app.route("/", api);
  await app.request("/boom");
  expect(seen).toContain("boom");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/honox/test/route.test.ts`
Expected: FAIL —— `createApi` 还不接受第二个参数；最后一条断言 `seen` 为空（复现 Proxy bug）。

- [ ] **Step 3: 重写 `route.ts`**

- `createApi(module)` 内部 `new Hono<HonoxEnv>()`，Proxy 上：
  - `get` 陷阱里先判 `ROUTE_METHOD_SET`；参数第二/第三个中若第三个是函数 → `(path, model, handler)` 形式，否则 `(path, handler)`。
  - 包 handler 时先 `c.set("api", { module, site, fn })`，再按方法解析：`GET`/`DELETE` 用 `parseQuery`，其余用 `parseBody`；解析结果作为第二个参数传给业务 handler。
  - **函数属性只有原型方法才 bind，实例自有字段（`errorHandler` / `routes`）原样返回**，并写注释说明为什么（父 `onError` 会被绕开）。
- `apiRoute(module, handler)` 同规则只包 handler。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/honox/test/route.test.ts`
Expected: PASS（包含 Proxy bug 那条）。

- [ ] **Step 5: Commit**

```bash
git add packages/honox/src/route.ts packages/honox/src/types.ts packages/honox/test/route.test.ts
git commit -m "feat(honox): createApi(module) 支持 (path, Model, handler)，修 Proxy 绑坏 errorHandler"
```

---

### Task 6: 中间件链与错误契约

**Files:**
- Modify: `packages/honox/src/middleware.ts`、`packages/honox/src/auth.ts`、`packages/honox/src/index.ts`
- Test: `packages/honox/test/middleware.test.ts`（新增），重写 `packages/honox/test/request-log.test.ts`（删除该文件，内容并入 middleware.test.ts）、调整 `packages/honox/test/create-honox.test.ts`

**Interfaces:**
- Consumes: `isRequestError`（Task 3）、`traceOf`（Task 2）。
- Produces: `installMiddleware(app, { log, auth, public, slowMs })`，链为 `rid → 计时兜底 → JWT → 门禁`。
- Produces: `createAuth(options, public, log)`。
- Produces: `HonoxOptions` 增加 `slowMs?: number`（默认 1000，`0` 关闭）；`createHonox` 安装 `notFound` 与 `onError`。
- Produces: 删除 `createRequestLog` 导出。

- [ ] **Step 1: 写失败测试**（每条一个 test，断言 `records` 里只有一条且字段匹配）

```ts
test("401：门禁拒绝记一条 warn，带 authError", …);
test("404：记一条 info，带 status 404", …);
test("抛 Error：记一条 error（有 stack），响应 500 且体是 ResponseX 契约", …);
test("RequestError：响应 400，不记 error 日志", …);
test("非 Error 抛出：记一条 error，响应 500", …);
test("慢请求：超过 slowMs 记一条 warn，带 durationMs", …);
test("业务自装 onError：500 仍有一条日志", …);
test("health 这类不写日志的路由：零日志", …);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/honox/test/middleware.test.ts`
Expected: FAIL —— `createRequestLog` 还在写两条，新断言全红。

- [ ] **Step 3: 改 `middleware.ts` / `auth.ts` / `index.ts`**

- `middleware.ts`：删 `createRequestLog`，保留 rid；新增计时包装（`await next()` 后读 `c.error` 与耗时；`catch` 记非 Error 后 rethrow；`isRequestError` 时不记；慢请求只在无 error 时记）。
- `auth.ts`：门禁分支记 warn（`{ rid, path, method, status: 401, authError }`），logger 由参数传入。
- `index.ts`：`slowMs` 选项；`app.notFound` 记 info 并返回 `ResponseX.notFound("接口不存在")`；`app.onError` 只做映射（`RequestError` → `ResponseX.fail`，其它 → `ResponseX.internalError("服务内部错误")`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/honox/test`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```bash
git add packages/honox/src packages/honox/test
git commit -m "refactor(honox): 请求日志改为业务自写 + 库内兜底，500/慢请求/401/404 各有日志"
```

---

### Task 7: model → schema 生成器

**Files:**
- Create: `scripts/gen-models.ts`、`test/gen-models.test.ts`
- Modify: 根 `package.json`（`"typescript-6": "npm:typescript@6.0.3"` 进 devDependencies）、`.githooks/pre-commit`

**Interfaces:**
- Produces: CLI `bun scripts/gen-models.ts <model 文件...>`，为每个输入文件写 `<name>.generated.ts`。
- Produces: 生成物导出 `<Class>Schema`、漂移断言 `type _<Class>InSync`；跨文件引用生成 `import { XSchema } from "./x.generated.js"`。
- Produces: 参数错误时 `process.exitCode = 1` 且 stderr 有可读信息。

- [ ] **Step 1: 写失败测试**

```ts
test("标量 / 数组 / 可选 / 嵌套 / 跨文件", async () => {
  // 在 tmp 目录写 models.ts + team.ts，跑生成器，读回生成物断言
  expect(out).toContain('ids: Type.Array(Type.Number())');
  expect(out).toContain('boss: Type.Optional(BossSchema)');
  expect(teamOut).toContain('import { BossSchema } from "./models.generated.js"');
});

test("循环引用 / 方法 / 泛型 / 未知类型 / 重名 都硬报错", async () => {
  // 每种各写一个最小文件，断言 stderr 含对应提示
});
```

- [ ] **Step 2: 跑测试确认失败** → `bun test test/gen-models.test.ts`
- [ ] **Step 3: 实现生成器**

按上面 spike 的结构：收集模型 → 校验字段（方法/缺类型标注/未知类型/联合/循环）→ 同文件拓扑排序（TDZ）→ 跨文件 import → 生成物带漂移断言。解析器用 `import ts from "typescript-6"`。

- [ ] **Step 4: 加进提交流程**

根 `package.json` 加 devDependency；`.githooks/pre-commit` 在 `bun run build` 之后加：

```sh
bun scripts/gen-models.ts examples/honox-app/app/model/*.ts
git add examples/honox-app/app/model/*.generated.ts
```

- [ ] **Step 5: 跑测试确认通过** → `bun test test/gen-models.test.ts`
- [ ] **Step 6: Commit**

```bash
git add scripts/gen-models.ts test/gen-models.test.ts package.json bun.lock .githooks/pre-commit
git commit -m "feat(scripts): model class 生成 TypeBox schema，带漂移断言"
```

---

### Task 8: 示例改造

**Files:**
- Create: `examples/honox-app/app/model/bots.ts`、`examples/honox-app/app/model/bots.generated.ts`、`examples/honox-app/app/model/index.ts`
- Modify: `examples/honox-app/app/api/bots.ts`、`examples/honox-app/app/api/health.ts`、`examples/honox-app/app/api/index.ts`、`examples/honox-app/app/main.ts`、`examples/honox-app/package.json`

**Interfaces:**
- Consumes: `createApi(module)`、`traceOf(ctx)`、`registerModel` / 生成物（Task 2/4/5/7）。

- [ ] **Step 1: 写模型并生成**

`app/model/bots.ts` 写 `Boss` / `BotsQuery` / `BotsBody`（与 spec §5.5 一致），跑 `bun scripts/gen-models.ts app/model/*.ts` 得到生成物，写 `app/model/index.ts`：

```ts
import "./bots.generated.js";
```

- [ ] **Step 2: 改 `app/api/bots.ts`**

```ts
export const botsApi = createApi("api/bots");

botsApi.get("/bots", BotsQuery, (ctx, query) => {
  const trace = traceOf(ctx);
  trace.info({ id: query.id });
  return ctx.json(...);
});

botsApi.post("/bots", BotsBody, (ctx, body) => {
  traceOf(ctx).info({ ids: body.ids });
  return ctx.json(...);
});
```

`health.ts` 改成 `createApi("api/health")`，handler 不写日志。`main.ts` 在 `registerApis(app)` 之前 `import "./model/index.js";`。`examples/honox-app/package.json` 加 `@sinclair/typebox` 与 `@needle/got` 之外它需要的东西（若生成物 import typebox）。

- [ ] **Step 3: 验证**

Run: `bun run example:typecheck && bun run example:build`
Expected: 通过。

- [ ] **Step 4: 真跑一次确认日志行为**

Run: `bun run example` 后打 `/health`（无日志）、`/bots?id=2`（一条 info 带 `module":"api/bots"`）、`/bots?id=abc`（400 且**没有** error 日志）。
Expected: 与 spec §5.3 一致。

- [ ] **Step 5: Commit**

```bash
git add examples/honox-app
git commit -m "feat(example): 接口改用 model + traceOf，health 不再产生日志"
```

---

### Task 9: 文档、版本与全量验收

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-honox-design.md`（§8.4 / §8.4.3 重写为 trace + 兜底日志）、`docs/01.memory.md`、`docs/best-practices/node-server.md`、`package.json`（版本 patch +1）与三个子包版本

- [ ] **Step 1: 改 honox spec §8.4**

两行日志 → 业务自写 + 四类兜底日志；§8.4.3 删掉 callerDepth，改写成「module 手写一次，site 是 dev-only」。

- [ ] **Step 2: memory**

改写「日志行带调用点」那条为「调用点只给 error 栈，定位靠手写 module」；补一条「model class → schema 生成」决策（含 typescript-6 别名与原因）。

- [ ] **Step 3: best-practices**

`docs/best-practices/node-server.md` 加一句：Workers/浏览器构建禁止 `drop: ["console"]`，否则日志全丢（sink 在无 `process` 时退回 `console.log`）。

- [ ] **Step 4: 版本 + 全量验收**

Run: `bun run version:sync && bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add docs package.json packages/*/package.json bun.lock
git commit -m "docs: 请求日志与 model 生成的决策落盘，版本 0.3.53"
```
