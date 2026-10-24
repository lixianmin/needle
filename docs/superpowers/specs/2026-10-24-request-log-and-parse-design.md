# 请求日志提取 + 参数解析 + model 生成 设计

2026-10-24。影响 `@needle/logo`、`@needle/honox`、`examples/honox-app`、根 `scripts/`、`.githooks/`。

## 1 意图

三件事，同一批改动落地：

1. **请求日志从中间件里拿出来。** 现在 `createRequestLog`（`packages/honox/src/middleware.ts`）对每个请求无条件写进/出两行，health 也照写；而业务想记业务数据时，中间件记不到 handler 里的对象。需求是：**打不打、打什么、脱敏什么，由业务决定**，库只把 `rid` / `uid` / `path` / `module` 这些上下文绑好。
2. **参数反序列化收进库**：handler 第二个参数直接是校验过的对象，失败自动 400。
3. **模型用 TS class 写，schema 由脚本生成**：业务只写 class（`ids: number[] = []`），TypeBox 的 DSL 一行业务代码都不出现。

## 2 目标 / 非目标 / 反目标

目标：

- 业务在 handler 里 `traceOf(ctx).info({ ... })` 拿到带 `rid` / `uid` / `method` / `path` / `module` 的日志；health 这类不写就是零日志。
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
- **保留** `captureCallSite(skip)`：`createApi()` / `apiRoute()` 注册时仍要抓一次 `site`/`fn`。
- `buildRecord` / `formatPayload` / `formatLine` 不动：`site`/`fn` 仍可由 payload 提供，只进前缀。

### 5.2 `traceOf(ctx)`

```ts
export function traceOf(ctx: Context<AppEnv>, log: Logger = logo): Trace;
export interface Trace {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
```

- 生成时把 `rid` / `uid` / `method` / `path` / `module` / `site` / `fn` 从 `ctx` 取干净，之后打日志不再碰 `ctx`。
- 每次调用等价于 `log[level](base, ...args)`：**绑定字段在前、业务参数在后**，同名时业务覆盖（与 logo「后写的赢」一致）。
- 不往 `Context` 上挂任何东西（`c.error` 已被 Hono 占用；挂 `c.log` 又要声明合并污染所有 `Context`）。
- 用装配时注入的 logger：`installMiddleware` 把 `log` 写进 `ctx`（`HonoxEnv.Variables.log`），
  `traceOf` 读它，没有才退回全局 `logo`。这是「日志不进 request context」那条决策的唯一例外——
  否则 `createHonox({ logger })` 配的实例会被业务日志绕过，日志跑到两个地方去。
- `module` 只在 `createApi` / `apiRoute` 注册过的路由上有；裸 `app.get` 没有（见 §8）。

### 5.3 库内兜底日志

| 场景 | 位置 | 级别 | 字段 |
|---|---|---|---|
| 401 门禁拒绝 | `auth.ts` 门禁分支 | warn | `rid` `path` `method` `status:401` `authError` |
| 404 未命中 | `createHonox` 装的 `app.notFound` | info | `rid` `path` `method` `status:404` |
| 未捕获异常 | 计时包装 | error | `rid` `path` `method` `status:500` `durationMs` `uid` `module`（有则带）+ `error`（含栈） |
| 慢请求 | 计时包装 | warn | `rid` `path` `method` `status` `durationMs` `uid` `module`（有则带） |

- **500 的日志只有一个来源：计时包装，不是 `onError`**（业务自装 `onError` 会替换掉库里的；计时包装读 `c.error` 不受影响）。`onError` 只做映射，不记日志。
- 计时包装同时收非 Error 抛出（compose 不会把它们交给 `onError`），记一条后原样 rethrow。
- `isRequestError(c.error)` 为真时不记 error——客户端传错参数不是服务端故障。
- **慢请求 warn 只在没有 error 时发**（error 行已带 `durationMs`），避免一次慢失败记两条。
- `slowMs` 默认 **1000ms**，`0` 关闭。取值理由：人肉等待可接受的上界，覆盖慢数据库往返的典型量级。
- 计时包装装在 rid 之后、鉴权之前，包住鉴权 + 门禁 + handler 全程；`uid`/`module` 结束后读。
- 401 由 `createAuth` 直接拿注入的 logger 写（它有独立单测，不依赖 ctx 上的东西）。401/404 拿不到 `module`（路由未匹配）。

### 5.4 `createApi(module)` 与路由注册

```ts
botsApi.get("/bots", BotsQuery, (ctx, query) => …);     // GET/DELETE → query
botsApi.post("/bots", BotsBody, (ctx, body) => …);      // POST/PUT/PATCH → body
botsApi.get("/health", (ctx) => ctx.json({ ok: true })); // 不校验参数
```

- `module` 必填（`"api/bots"` 形态）：`traceOf(ctx)` 的 `module` 只能从注册处来。
- 注册时 `captureCallSite(1)` 抓 `site`/`fn`（dev-only，见 §8），连同 `module` 一起 `c.set("api", …)`。
- 模型按方法决定解析哪一侧：GET/DELETE → query，POST/PUT/PATCH → body。代价：一个路由不能同时校验 query 与 body（当前没有这种接口；真出现时再加）。
- **`createApi()` 的 Proxy 必须只绑原型方法**，实例自有字段（`errorHandler` / `routes`）原样返回——否则父 `onError` 收不到该组路由的异常（§3 实测）。
- `HonoxEnv.Variables.api` 变成 `{ module: string; site?: string; fn?: string }`。

### 5.5 model → schema 生成

手写（唯一真值）：

```ts
// app/model/bots.ts
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
// app/model/bots.generated.ts
export const BossSchema = Type.Object({ name: Type.String(), level: Type.Number() }, { additionalProperties: false });
export const BotsBodySchema = Type.Object({
  ids: Type.Array(Type.Number()),
  boss: Type.Optional(BossSchema),
}, { additionalProperties: false });

// 漂移检查：class 改了没重新生成，tsc 报错
type _BotsBodyInSync = Assert<Equals<Static<typeof BotsBodySchema>, BotsBody>>;
```

- 生成器 `scripts/gen-models.ts`（约 160 行），读全部 model 文件：
  - 支持：标量、`T[]` / `Array<T>`、同文件与跨文件 class 嵌套、`?` 可选、`Date`（→ `format: date-time`）。
  - **硬报错**（不静默降级）：方法/getter/装饰器/泛型/任意联合/未声明的类型/字段缺类型标注/循环引用/跨文件重名。
  - 同文件内按依赖拓扑排序（`const` 有 TDZ，顺序错了模块初始化就炸）；跨文件自动 `import { XSchema } from "./x.generated.js"`。
- 解析器用 `typescript-6`（npm 别名 `npm:typescript@6.0.3`，只进 devDependencies，23MB，不进产物）。项目编译器仍是 7.0.2。
- schema 注册：生成物调 `registerModel("BotsBody", BotsBodySchema)`（用类名，不用类值，避免与 model 文件形成运行时环）。路由拿到 class 后按 `class.name` 懒查注册表；查不到就抛一条带修复提示的错误（「先 import app/model/index.js」）。
- `additionalProperties: false` 只作用在 body；`parseQuery` 先按 schema 声明的键过滤，再校验——query 上多带的参数（`_t` 之类）不会 400。

### 5.6 参数解析

`packages/honox/src/parse.ts`：

- query：`URLSearchParams` → 对象。重复键且 schema 里是数组 → 全部值，否则取最后一个；空串（`?id=`）视为未传（否则 `Value.Convert` 把 `""` 变 `0`）；只保留 schema 声明的键。然后 `Value.Convert`（`"1"`→`1`）→ `Value.Default` → `Value.Errors`。
- body：`c.req.json()` 失败 → `body 不是合法 JSON`；**不转换**（`Value.Parse` 会把 `true` 变 `1`）→ `Value.Default` → `Value.Errors`。
- 失败抛 `RequestError`；message 由错误列表拼：`body /ids/0 Expected number`（首个错误 + 其余数量）。
- `RequestError`：`new RequestError(message)` = 400 + `bad_request`；`new RequestError(status, code, message)` 是完整形态，`onError` 用 `ResponseX.fail(status, code, message)` 原样尊重。

### 5.7 `onError` 与错误契约

- `createHonox` 装 `app.onError`：`RequestError` → `ResponseX.fail(...)`，其它 → `ResponseX.internalError("服务内部错误")`；**不记日志**。
- 500 响应体从 Hono 默认纯文本变成 `{code:"internal_error",message}`。业务自装 `onError` 时映射要自己转交（导出 `isRequestError`），但 500 的**日志**不受影响。
- 导出 `RequestError` / `isRequestError`。

### 5.8 中间件链

`rid` → `计时兜底（500 / 慢请求）` → `JWT` → `门禁`。`createRequestLog` 删除，`x-rid` 响应头保留。

## 6 示例改动

- `app/model/bots.ts` + `app/model/bots.generated.ts` + `app/model/index.ts`（barrel，把生成物 import 一遍）。
- `app/api/bots.ts`：`createApi("api/bots")` + `(ctx, query)` / `(ctx, body)` + `traceOf(ctx)`。
- `app/api/health.ts`：`createApi("api/health")`，handler 不写日志——零日志正是要的效果。
- `app/main.ts` 启动前 import `./model/index.js`。

## 7 测试

- logo：`info`/`warn` 不再产生 `site`；`error` 仍有 `stack`；`captureCallSite()` 仍返回 `文件:行`；删掉 `callerDepth` 的两条测试。
- honox 路由：`(path, Model, handler)` 能解析 query/body；裸 `(path, handler)` 照旧；模型未注册 → 明确报错；query 多余键不 400、body 多余字段 400。
- honox 日志：401 / 404 / 500 / 慢请求各一条且字段正确；业务自装 `onError` 时 500 仍有日志；`throw "字符串"` 有日志且响应 500；`RequestError` 不记 error；health 零日志。
- 代理：`createApi()` 挂到父 app 后，组内路由抛错仍走父 `onError`（钉住 §3 那个 bug）。
- 生成器：嵌套/跨文件/数组/可选/漂移检查（双向）/循环引用报错/重名报错/方法声明报错。
- 示例：`example:typecheck` + `bun run example` 后 `/health` 无日志、`/bots` 带 `module`。

## 8 已知限制

- **打包后 `site`/`fn` 是 bundle 坐标**；`module` 才是生产定位手段。
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
- `examples/honox-app/app/model/*`、`app/api/{bots,health}.ts`、`app/main.ts`、`examples/honox-app/package.json`
- 本 spec、`docs/superpowers/specs/2026-10-24-honox-design.md`（§8.4 / §8.4.3 重写）、`docs/01.memory.md`、`docs/best-practices/node-server.md`（drop console 禁令）
