# 请求日志提取 + 参数解析 + model 生成 设计

2026-10-24。影响 `@needle/logo`、`@needle/honox`、`examples/honox-app`、根 `scripts/`、`.githooks/`。

## 1 意图

三件事，同一批改动落地：

1. **请求日志从中间件里拿出来。** 现在 `createRequestLog`（`packages/honox/src/middleware.ts`）对每个请求无条件写进/出两行，health 也照写；而业务想记业务数据时，中间件记不到 handler 里的对象。需求是：**打不打、打什么、脱敏什么，由业务决定**，库只把 `rid` / `uid` / `path` / `module` 这些上下文绑好。
2. **参数反序列化收进库**：handler 第二个参数直接是校验过的对象，失败自动 400。
3. **模型用 TS class 写，schema 由脚本生成**：业务只写 class（`ids: number[] = []`），TypeBox 的 DSL 一行业务代码都不出现。

## 2 目标 / 非目标 / 反目标

目标：

- 业务在 handler 里 `traceOf(ctx).info({ ... })` 拿到带 `rid` / `uid` / `path` 的日志，`module` 进行前缀；health 这类不写就是零日志。
- 库内自己产生的失败（401 / 404 / 500 / 慢请求）仍然有日志——这些地方没有 handler，业务补不了。
- `botsApi.post("/bots", BotsBody, (ctx, body) => …)`：一处声明、无花括号对象、无 TypeBox。
- 日志在**打包后**仍能看出「来自哪个模块」。

非目标：不做日志采样/审计/动态开关；不动 Shell 面板的日志读取与展示；不引入反射式校验（装饰器）；不支持递归模型。

反目标：为了「每条日志都有调用点」在每条日志上构造 `Error`，却在打包后拿到 `index.js:1234`——付了代价、结果无效。

## 3 既有事实（实测）

| 事实 | 证据 |
|---|---|
| `logo` 每条日志构造一次 `Error` 抓调用点 | `packages/logo/src/logo.ts:255` |
| 打包后调用点变成 bundle 坐标，注册时抓也一样 | spike：源码 `site.ts:2` → `--outfile` `dist/site.js:4` → `--minify` `dist/site.min.js:2` |
| `logo` 的 `site`/`fn` 由 payload 提供时优先 | `packages/logo/src/record.ts:182` |
| `logo` 只把**纯对象**合并成字段，class 实例进 `msg` | `record.ts` 的 `isPlainObject` / `safeStringify` |
| 压缩器只删 `console.*`，不删未知对象的方法调用 | spike：`bun build --minify` 产物里 `.info(`、payload 键、`rid` 字面量都在 |
| `Context.error` 是 Hono 的公开字段，compose 每次 Error 抛出都写它 | `hono/dist/types/context.d.ts:222`；`compose.js:37` |
| compose 只把 `Error` 交给 `onError`，非 Error 抛出会穿到中间件 | `compose.js:37-41` |
| `errorHandler` 恒存在，业务 `app.onError` 是单槽替换 | `hono-base.js:86`、`hono-base.js:153` |
| `createApi()` 的 Proxy 把所有函数属性 `bind()`，`errorHandler` 变成绑定副本 → 父 `route()` 误判子 app 自带错误处理，**父 `onError` 收不到该组路由的异常** | `route.ts:71-75`；`hono-base.js:109`；spike 复现：校验失败返回纯文本 500 |
| `typescript@7.0.2` 没有编译器 API（导出 2 个 key，`createSourceFile` 为 undefined） | `require("typescript")` 实测 |
| `typescript@6.0.3` 保留完整老 API（2248 个 key） | 实测 |
| `typescript@6.0.3` 可与 7.0.2 并存（npm 别名 `typescript-6`） | 实测：`import ts from "typescript-6"` → 6.0.3，`import * as v7 from "typescript"` → 7.0.2 |
| `@sinclair/typebox@0.34.52` 在 TS 7 下类型检查通过 | spike：`tsc -p` 退出码 0 |
| `Value.Parse` 会做类型转换（`"1"` → `1`，`true` → `1`） | spike；所以 body 用 `Value.Errors` 不做 Convert |
| `Value.Default` 就地改对象（不克隆） | spike；`req.json()` 的对象本次请求独占，无碍 |

## 4 方案

### 4.1 日志

- **A. 中间件自动日志 + 按路由开关。** 否决：开关只能表达「要不要」，表达不了「密码不打、大字段要裁」；且入口行在路由匹配前，拿不到开关。
- **B. 全手动 + 库内兜底（选中）。** 中间件只留 rid、计时兜底与鉴权；业务用 `traceOf(ctx)` 自己写；401 / 404 / 500 / 慢请求由库补。

### 4.2 参数解析

- 手写 guard：零依赖但每个接口手写一份校验，与目标相反。
- zod / valibot：能一处声明，但与 TS 推断结合不如 TypeBox 紧。
- **TypeBox（选中）**：`Static<>` 直接给类型用，`Value.Errors` 给 `path` + `message`。
- 类 + 装饰器反射：需要 `emitDecoratorMetadata`，TS 7 不保证支持，且业务侧要开装饰器配置。

### 4.3 schema 的来源

- 手写 TypeBox（`Type.Object({ ids: Type.Array(Type.Number()) })`）：零工具链，但业务代码里出现 DSL。
- `.proto` → 代码生成：`minItems` 这类约束在 proto 语法里没有位置，只能自定义 option，等于自造词汇表，还要背字段号。
- 自研 DSL → 代码生成：等于维护一个只有自己认的语法和解析器。
- **TS class → TypeBox 生成（选中）**：业务只写 class，约束靠「类型」本身；生成器 160 行，用现成的 TS 编译器 API 解析，生成物提交、pre-commit 重建。

## 5 设计

### 5.1 `@needle/logo`：只有 error 级抓栈

- `emit` 不再无条件 `externalFrames()`：`withStack` 命中（默认只有 `error`）时构造一次 `Error` 取栈，`info`/`warn`/`debug` **零构造**。
- 删 `LoggerOptions.callerDepth` 与 `child()` 里的透传（它只为修补「助手包一层位置就歪」，入口没了就没有意义）。包未发布，直接删。
- **删除 `captureCallSite`**：路由注册不再抓 `文件:行`——打包后那是 bundle 坐标，`module` 已经是定位手段；包内没有别的消费者。
- `buildRecord` / `formatPayload` / `formatLine`：`site`/`fn` 仍可由 payload 提供，只进前缀；新增同义的 `module`（模块名）也走前缀、不进 JSON，两者都有时 `site` 优先。

### 5.2 `traceOf(ctx)`

```ts
export function traceOf(ctx: Context<HonoxEnv>, log?: Logger): Trace;
export interface Trace {
  debug(...args: unknown[]): Trace;
  info(...args: unknown[]): Trace;
  warn(...args: unknown[]): Trace;
  error(...args: unknown[]): Trace;
  json(body: unknown, status?: ContentfulStatusCode): Response;
  badRequest(message?: string): Response;
  notFound(message?: string): Response;
  internalError(message?: string): Response;
  unavailable(message?: string): Response;
}
```

- 四个级别方法**返回 trace 自己**，所以「建 trace + 打第一条日志」一行写完：`const trace = traceOf(ctx).info(request)`。
- 五个响应出口（`json` / `badRequest` / `notFound` / `internalError` / `unavailable`）规则只有一条：**记的那一行就是它返回的响应**。
  `json` 记 `{status, result: body}`，其余四个记 `{status: 4xx|5xx, result: {code, message}}`，状态码与 `code` 与 `ResponseX` 同一套契约、由出口锁死。
  所以五个方法都只有一个参数，不存在「第一个参数是日志负载、第二个是响应」那种读不出意图的形状。
  业务想额外记字段就显式链一个 `.info({...})`（它返回 trace 自己），不想要就 `trace.notFound("…")` 一行。
  不想记这条响应日志就直接用 `ctx.json`。
- 实现用一个类的原型方法，不是每次现挂九个闭包：每个请求只分配一个实例，九个方法挂在原型上共享（2026-10-25 实测创建 + 一条 info 65ns → 24ns、680B → 88B / trace）。
  因此**方法依赖 `this`**：`trace.info()` / `trace["json"]()` / `trace.info().json()` 都正常，但把方法摘下来单独调用（`const { json } = trace; json(...)`）会抛 TypeError——要传给别处就传 trace 本身。
- 生成时把 `rid` / `uid` / `path` / `module` 从 `ctx` 取干净，之后打日志不再碰 `ctx`（`json` / `notFound` 要造响应，仍要用它）。`module` 只进行前缀，不重复写进 JSON。
- 每次调用等价于 `log[level](base, ...args)`：**绑定字段在前、业务参数在后**，同名时业务覆盖（与 logo「后写的赢」一致）。
- 不往 `Context` 上挂任何东西（`c.error` 已被 Hono 占用；挂 `c.log` 又要声明合并污染所有 `Context`）。
- 用装配时注入的 logger：`installMiddleware` 把 `log` 写进 `ctx`（`HonoxEnv.Variables.log`），
  `traceOf` 读它，没有才退回全局 `logo`。这是「日志不进 request context」那条决策的唯一例外——
  否则 `createHonox({ logger })` 配的实例会被业务日志绕过，日志跑到两个地方去。
- `module` 只在 `createApi` / `apiRoute` 注册过的路由上有；裸 `app.get` 没有（见 §8）。

### 5.3 库内兜底日志

| 场景 | 位置 | 级别 | 字段 |
|---|---|---|---|
| 401 门禁拒绝 | `auth.ts` 门禁分支 | warn | `rid` `path` `status:401` `authError` |
| 404 未命中 | `createHonox` 装的 `app.notFound` | info | `rid` `path` `status:404` |
| 未捕获异常 | 计时包装 | error | `rid` `path` `status:500` `durationMs` `uid` `module`（有则带）+ `error`（含栈） |
| 慢请求 | 计时包装 | warn | `rid` `path` `status` `durationMs` `uid` `module`（有则带） |

- **500 的日志只有一个来源：计时包装，不是 `onError`**（业务自装 `onError` 会替换掉库里的；计时包装读 `c.error` 不受影响）。`onError` 只做映射，不记日志。
- 计时包装同时收非 Error 抛出（compose 不会把它们交给 `onError`），记一条后原样 rethrow。
- `isRequestError(c.error)` 为真时**且状态码 < 500** 才不记——客户端传错参数不是服务端故障；
  `RequestError(503, …)` 这类 5xx 仍然要留一行 error。
- **慢请求 warn 只在没有 error 时发**（error 行已带 `durationMs`），避免一次慢失败记两条。
- `slowMs` 默认 **1000ms**，`0` 关闭。取值理由：人肉等待可接受的上界，覆盖慢数据库往返的典型量级。
- 计时包装装在 rid 之后、鉴权之前，包住鉴权 + 门禁 + handler 全程；`uid`/`module` 结束后读。
- 401 由 `createAuthGuard` 直接拿注入的 logger 写（它有独立单测，不依赖 ctx 上的东西）。401/404 拿不到 `module`（路由未匹配）。

### 5.4 `createApi(module)` 与路由注册

```ts
botsApi.get("/bots", BotsQuery, (ctx, request) => …);     // GET/DELETE → query
botsApi.post("/bots", BotsBody, (ctx, request) => …);     // POST/PUT/PATCH → body
botsApi.get("/health", (ctx) => ctx.json({ ok: true }));  // 不校验参数
```

第二个参数统一叫 `request`：GET 时是 query 参数、其余是 body，业务只关心「这次请求的参数」。

- `logModule` 必填（`"bots.ts"` 形态：源文件名带扩展名，不是路由路径）：`traceOf(ctx)` 的 `module` 只能从注册处来。
- 注册时只把 `module` 写进 context（`c.set("api", { module })`）：不再抓注册位置。
- 模型按方法决定解析哪一侧：GET/DELETE → query，POST/PUT/PATCH → body。代价：一个路由不能同时校验 query 与 body（当前没有这种接口；真出现时再加）。
- **`createApi()` 的 Proxy 必须只绑原型方法**，实例自有字段（`errorHandler` / `routes`）原样返回——否则父 `onError` 收不到该组路由的异常（§3 实测）。
- `HonoxEnv.Variables.api` 是 `{ module: string }`（`createApi` / `apiRoute` 一定写；裸 `app.get` 没有）。

### 5.5 model → schema 生成

手写（唯一真值）：

```ts
// app/beans/bots.ts
export class Boss {
  name: string = "";
  level: number = 0;
}

export class BotsQuery {
  id?: number;
}

export class BotsBody {
  ids: number[] = [];
  boss?: Boss;
}
```

生成（提交进仓库，勿手改）：

```ts
// app/beans/bots.generated.ts
export const BossSchema = Type.Object({ name: Type.String(), level: Type.Number() }, { additionalProperties: false });
export const BotsBodySchema = Type.Object({
  ids: Type.Array(Type.Number()),
  boss: Type.Optional(BossSchema),
}, { additionalProperties: false });

// 漂移检查：class 改了没重新生成，tsc 报错
type _BotsBodyInSync = Assert<Equals<Static<typeof BotsBodySchema>, BotsBody>>;
```

- 生成器 `scripts/gen-models.ts`（约 160 行），读全部 model 文件：
  - 支持：标量、`T[]` / `Array<T>`、同文件与跨文件 class 嵌套、`?` 可选。
  - **不支持 `Date`**：JSON 里它是字符串，`Static<>` 是 `string`、class 字段是 `Date`，漂移断言永远过不去；要日期就写 `string`。
  - **硬报错**（不静默降级）：方法/getter/装饰器/泛型/任意联合/未声明的类型/字段缺类型标注/循环引用/跨文件重名。
  - 同文件内按依赖拓扑排序（`const` 有 TDZ，顺序错了模块初始化就炸）；跨文件自动 `import { XSchema } from "./x.generated.js"`。
- 解析器用 `typescript-6`（npm 别名 `npm:typescript@6.0.3`，只进 devDependencies，23MB，不进产物）。项目编译器仍是 7.0.2。
- schema 注册：生成物调 `registerModel("BotsBody", BotsBodySchema)`（用类名，不用类值，避免与 bean 文件形成运行时环）。谁 import 手写的 bean 文件，谁就顺带把 schema 注册好——bean 文件顶部有一行 `import "./bots.generated.js"`，所以不需要额外的 barrel。路由拿到 class 后按 `class.name` 懒查注册表；查不到就抛一条带修复提示的错误（「先 import 那个 bean 文件」）。
- `additionalProperties: false` 只作用在 body；`parseQuery` 先按 schema 声明的键过滤，再校验——query 上多带的参数（`_t` 之类）不会 400。

### 5.6 参数解析

`packages/honox/src/parse.ts`：

- query：`URLSearchParams` → 对象。重复键且 schema 里是数组 → 全部值，否则取最后一个；空串（`?id=`）视为未传（否则 `Value.Convert` 把 `""` 变 `0`）；只保留 schema 声明的键。然后 `Value.Convert`（`"1"`→`1`）→ `Value.Default` → `Value.Errors`。
- body：`c.req.json()` 失败 → `body 不是合法 JSON`；**不转换**（`Value.Parse` 会把 `true` 变 `1`）→ `Value.Default` → `Value.Errors`。
- 失败抛 `RequestError`；message 由错误列表拼：`body /ids/0 Expected number`（首个错误 + 其余数量）。
- `RequestError`：`new RequestError(message)` = 400 + `bad_request`；`new RequestError(status, code, message)` 是完整形态，`onError` 用 `ResponseX.fail(status, code, message)` 原样尊重。

### 5.7 `onError` 与错误契约

- `createHonox` 装 `app.onError`，三种来源分开映射，**都不记日志**：
  - `RequestError` → `ResponseX.fail(status, code, message)`；
  - `HTTPException`（Hono 自带中间件抛的）→ 自带 `res` 时原样用（`basic-auth` 要带 `WWW-Authenticate`），否则
    `ResponseX.fail(status, codeForStatus(status), 5xx ? "服务内部错误" : message)`——message-only 的
    `HTTPException.getResponse()` 会吐 text/plain，破坏 `{code, message}` 契约；5xx 还要避免把内部消息带出去；
  - 其它 → `ResponseX.internalError("服务内部错误")`。
- 500 响应体从 Hono 默认纯文本变成 `{code:"internal_error",message}`。业务自装 `onError` 时映射要自己转交（导出 `isRequestError`），但 500 的**日志**不受影响。
- 导出 `RequestError` / `isRequestError`。

### 5.8 中间件链

`rid` → `计时兜底（500 / 慢请求）` → `JWT` → `门禁`。`createRequestLog` 删除，`x-rid` 响应头保留。

## 6 示例改动

- `app/beans/bots.ts`（手写 class，顶部 `import "./bots.generated.js"` 完成 schema 注册）+ `app/beans/bots.generated.ts`（生成物）。业务只 import `../beans/bots.js`——一个 bean 一对文件，没有 barrel：多一个 `index.js` 只是把 `bots.js` 换成 `index.js`，路径长度没变，却多一处要维护的汇总。
- `app/api/bots.ts`：`createApi("bots.ts")` + `(ctx, request)`；`const trace = traceOf(ctx).info(request)` 一行建 trace 并落第一条日志，之后每个出口 `trace.json` / `trace.notFound`。两条路由都是 POST：`POST /bots/get_bots`（body `{id?}`：带 id 取单条、空 body 取全表）、`POST /bots/get_bot_name`（body `{id}`，只回 `{name}`，查不到 404）。**参数放 body，不放路径段也不走 query**：路径里放 id 会让不存在的 id 也命中路由；query 入口只留给协议要求的 GET（页面、`/health`）。
- **handler 参数不写类型注解**：模型参数 + 推断已经给全了 `ctx: Context<HonoxEnv>` 与 `request: BotNameBody`；再写一遍既是同一信息出现两次，也会在模型改名时留下第二处要改的地方。
- `app/api/health.ts`：`createApi("health.ts")`，handler 不写日志——零日志正是要的效果。
- `app/main.ts` 不需要 import beans：注册随 bean 文件本身传播。

## 7 测试

- logo：`info`/`warn` 不再产生 `site`；`error` 仍有 `stack`；`captureCallSite` 与其测试删除；`formatLine` 的 `module` 进前缀、不进 JSON。
- honox 路由：`(path, Model, handler)` 能解析 query/body；裸 `(path, handler)` 照旧；模型未注册 → 明确报错；query 多余键不 400、body 多余字段 400。
- honox 日志：401 / 404 / 500 / 慢请求各一条且字段正确；业务自装 `onError` 时 500 仍有日志；`throw "字符串"` 有日志且响应 500；`RequestError` 不记 error；health 零日志。
- 代理：`createApi()` 挂到父 app 后，组内路由抛错仍走父 `onError`（钉住 §3 那个 bug）。
- 生成器：嵌套/跨文件/数组/可选/漂移检查（双向）/循环引用报错/重名报错/方法声明报错。
- 示例：`example:typecheck` + `bun run example` 后 `/health` 无日志、`/bots/get_bots` 的日志前缀是 `bots.ts`。

## 8 已知限制

- **日志里没有 `site`/`fn`**：注册位置不再抓，打包后那只会是 bundle 坐标；定位靠手写的 `module`（行前缀）。
- **Workers / 浏览器侧开 `drop: ["console"]` 会让日志全部消失**：那些环境里 stdout sink 退回 `console.log`（`packages/logo/src/sinks/stdout.ts:40`）；Node/Bun 走 `process.stdout.write`，不受影响。
- Shell 面板自身请求不再有访问日志（exec 失败仍记 error）。
- 走 `createHonox` 但直接 `app.get(...)` 注册的路由：有 `traceOf(ctx)`、没有 `module`。
- 模型不支持递归结构（生成器硬报错）。
- 运行时拿到的是普通对象，不是 `new BotsBody()` 实例——class 里不要写方法。

## 9 影响面

- `packages/logo/src/logo.ts`、`packages/logo/test/logger.test.ts`
- `packages/honox/src/{middleware,route,types,index,auth,request,parse,trace,model}.ts`、`packages/honox/test/*`
- `packages/honox/package.json`、根 `package.json`（`typescript-6` 别名）
- `scripts/gen-models.ts`、`.githooks/pre-commit`
- `examples/honox-app/app/beans/*`、`app/api/{bots,health}.ts`、`app/main.ts`、`examples/honox-app/package.json`
- 本 spec、`docs/superpowers/specs/2026-10-24-honox-design.md`（§8.4 / §8.4.3 重写）、`docs/01.memory.md`、`docs/best-practices/node-server.md`（drop console 禁令）
