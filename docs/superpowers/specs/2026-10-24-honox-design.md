# @needle/honox 设计

日期：2026-10-24
状态：待人类批准

> **2026-10-30 更新：rid 的生成器从 `nextUlid()`（ULID）换成 `nextId()`（UUIDv7 位布局 + 26 位 Crockford Base32，同一毫秒内随机段 +1），`@needle/got` 删除 ULID 与 Snowflake，只留一套 id。见 `2026-10-30-id-generator-design.md`；§8.4.1 正文保留当时写法。**

## 1. 结论

在 `packages/honox` 新增 `@needle/honox`：一个跟业务无关的 Hono 底座。它做四件事——配置加载、鉴权、兜底日志、可选 MongoDB——外加把 `@needle/shell` 的控制台挂上去。示例 app 放在 `examples/honox-app`（纯 Hono + `bun build` + Dockerfile），用来说明它怎么接。

库本身**不 import honox**，也不用 npm 上的 `honox`（HonoX）：底座返回的就是 `Hono` 实例，路由直接挂在上面。业务若真要 HonoX 的文件路由/islands，自行 `createApp({ app: createHonox(...) })` 接入（验证见 §7）。

## 2. 为什么

每起一个新项目都要重写一遍同样的东西：读配置、解 JWT、按接口挂鉴权、每请求打日志、连 Mongo、挂调试面板。抄来抄去不但慢，而且每次都抄得不一样——A 项目的 401 返回 `{error}`，B 项目返回 `{code, message}`；A 项目默认放行，B 项目默认拒绝。

把这一层固化成包，新项目 `import` 就开工，行为口径全仓库一套。本仓库已有 `@needle/logo`（日志）和 `@needle/shell`（控制台），正好是这一层的天然依赖。

## 3. 目标

- 新项目三行代码拿到：配置对象、兜底日志 + `traceOf(ctx)`、JWT 鉴权、可选 Mongo 连接池。
- 一张 Excel sheet 变成一个类型化、按 id 取数的配置源（`getXxx(id)` / 全表），沿用 rim.proxy 的使用习惯。
- 鉴权默认拒绝（fail-closed）：没声明过的接口一律要求登录，公开接口写进白名单。
- 401 响应复用 `@needle/shell` 的 `ResponseX`，全仓库一套错误契约。
- 库的根入口在任何运行时（含 Workers / 浏览器打包）都不带 `node:`。
- 示例 app 能真的构建、真的打 Docker 镜像、真的跑起来。

## 4. 非目标

- 登录接口本身（发 token、刷新 token、注册）。库只负责解 token 和拦请求。
- CORS、限流、审计、多租户。需要时再加，不预埋开关。
- 把库做成 HonoX 插件或 Vite 插件。
- 发布到 npm。沿用本仓库现状：`bun link`。

## 5. 反目标（做成了也算失败）

- 库的根入口 import 了 `honox`、`mongodb`、`node:fs` 中的任何一个——根入口必须能进 Workers 打包。
- 业务项目必须自己保证中间件注册顺序才能正确鉴权。
- 出现「默认公开，忘了加鉴权就裸奔」的路径。
- 库里出现只有一种实现的接口/钩子（比如为了将来支持 RS256 而先留的 `verify?`）。

## 6. 约束

- **依赖方向**：`honox → shell → logo`，`core` 不依赖任何包。
- **与既有决策「needle 自己不依赖 Hono」的冲突及解除方式。** `packages/shell/test/no-hono-coupling.test.ts` 现在钉的是整个 `packages/` + `examples/`：依赖表、依赖图「只有一条生产边 shell → logo」、入口表、源码里不许 `from "hono"`，四条全查；memory.md 2026-10-22 也记了这条决策。`@needle/honox` 会全撞红。人类已拍板：**不是废掉这条决策，而是收窄口径**——`core` / `logo` / `shell` 三个包依旧不依赖 Hono、不提供框架适配入口，这条性质保持不变；`@needle/honox` 成为唯一、显式的例外。落地方式：测试改成按包分组断言 + 新增「整个仓库只有 honox 的依赖表/源码可以出现 hono」，依赖图与入口表补上 honox，同一个提交更新 memory.md 那条决策。
- **TypeScript 7 与 HonoX 不兼容（已实测）**：honox 0.1.62 的岛检测经 `precinct` → `@typescript-eslint/typescript-estree` 调用 TS API，在 TS 7.0.2 上抛 `TypeError: Cannot read properties of undefined (reading 'Cjs')`，vite 连配置都加载不了；换 5.9.3 立即通过。**结论：示例不引 HonoX**，因此这条约束不再生效，示例的 TypeScript 与根同为 7.0.2（测试钉住）。业务若要 HonoX，需自行降级 TS 或等上游修修。
- **按环境拆入口是本仓库既定做法**（`@needle/logo`、`@needle/shell` 都有 `./node`）：根入口无 `node:`，Node 专属能力走子入口。
- **控制流必须带花括号**，语句体独占多行（AGENTS.md 代码风格）。

## 7. 选过的方案

API 形状有三个候选，人类选了 B。

| 方案 | 内容 | 结论 |
|---|---|---|
| A | `installHonox(app, options)` 往现成 app 上装 | 与 HonoX 天然兼容，但库要读业务已有的 app，装配顺序与库内部状态耦合 |
| **B** | **`createHonox(options)` 返回新 Hono 实例** | **选中**：业务不自己建 app，装配顺序全由库管；HonoX 侧用 `createApp({ app })` 接入 |
| C | 只导出散件中间件，业务自己 `app.use` | 顺序与默认值全压在使用者身上，与「默认拒绝」的目标冲突 |

B 原本被认为和 HonoX 的文件路由冲突（HonoX 自己 `createApp()` 建 app），spike 证伪了这个担心：

- `honox/dist/server/server.js`：`const app = options.app ?? new Hono()`——`createApp({ app })` 支持传入现成实例，文件路由与 `_middleware` 全部 `route()` 到它上面。
- 运行时验证（`/tmp/honox-spike`，honox 0.1.62 + hono 4.13.13 + vite 8.3.5）：

  ```
  [parent] resolve uid /me u1
  [parent] <-- GET /me 200 uid=u1
  GET /health → 200 {"ok":true}          # 白名单
  GET /me（无 token）→ 401 {"code":"unauthorized",...}   # 门禁先短路，文件路由没进
  GET /me（带 uid）  → 200 {"uid":"u1"}   # 文件路由里读得到父层 c.get('uid')
  ```

所以库只依赖 `hono`，HonoX 只是业务侧的一种可选接法：`createApp({ app: createHonox(...) })`。示例 app 不用 HonoX（理由见 8.8）。

### 7.1 Excel 读取的方案对比

从 rim.proxy 的 `excel-utils.ts` 出发，保留它的数据模型（sheet ↔ 模型、表头归一、id 索引、一表一 getter），候选过三种读取方式：

| 方案 | 结论 |
|---|---|
| `xlsx`（SheetJS）同步读、真懒加载 | 调用形态与原项目一致，但 npm 停在 0.18.5 且有已知 CVE；新版只能从官方 CDN 装，锁文件指外链 |
| `hucre` / `@jetstreamapp/simple-excel` + 真懒加载 | 两个库都只能异步读（zip 解压走 `DecompressionStream` / 流式），getter 必须变 async，每个调用点都要改 |
| **`hucre` + 启动预载，getter 保持同步** | **选中**：`await metadata.load(dir)` 一次，之后同步零 IO，业务侧与 rim.proxy 形态一致；代价是启动时多一次解析 |

hucre 选它而不是 simple-excel：配置表就几张、几千行，用不上流式；`hucre/xlsx` 读路径约 34 KB gzip，simple-excel 是 508 KB 的流式引擎。

## 8. 设计

### 8.1 包结构与入口

```
packages/honox/
  package.json          # exports: "." / "./node" / "./mongo" / "./excel"
  src/index.ts          # createHonox + 类型（无 node:）
  src/auth.ts           # JWT 解析 + 门禁 + 白名单匹配
  src/parse.ts          # body / query 解析（TypeBox）
  src/config.ts         # 合并/必填检查（纯逻辑，node 入口复用）
  src/node.ts           # loadConfig（读 YAML）
  src/mongo.ts          # createMongo / withTransaction
  src/excel.ts          # createMetadata / Template / Config（扫目录读 Excel）
  src/middleware.ts     # installMiddleware：rid → 兜底日志 → JWT → 门禁
  test/*.test.ts
  tsconfig.build.json
```

- `dependencies`：`@needle/got`、`@needle/shell`、`@needle/logo`（workspace）、`yaml`（读 YAML）、`hucre`（读 Excel；只在 `./excel` 入口被 import）。
- `peerDependencies`：`hono: "^4"`；`mongodb` 为 **optional peer**（`peerDependenciesMeta`），不装就不会被打包。
- **不依赖** `honox`、`vite`。

### 8.2 `createHonox(options)`

```ts
export interface HonoxOptions {
  /** 请求日志用哪个 logger；默认全局 logo。 */
  logger?: Logger;                           // 默认 @needle/logo 的 logo 实例
  auth: {
    secret: string;                          // HS256 密钥
    claim?: string;                          // uid 取哪个 claim，默认 "sub"
    header?: string;                         // 默认 "authorization"（Bearer xxx）
    cookie?: string;                         // 可选：从 cookie 读 token（如 "token"）
  };                                         // 白名单不在这里，见 8.3
  shell?: ServerShellOptions;                // 传了就把控制台挂到 shell.basePath（默认 "/shell"）
  slowMs?: number;                           // 慢请求阈值（毫秒），默认 1000，0 关闭
}

export type HonoxApp = Hono<HonoxEnv> & {
  allowAnonymous(entries: readonly PublicEntry[]): HonoxApp;
};

export function createHonox(options: HonoxOptions): HonoxApp;
```

`HonoxEnv` 的 Variables：`uid: string | null`、`user: JwtPayload | null`、`authError: "missing" | "invalid" | "expired" | null`、`rid: string`、`logger?: Logger`（`installMiddleware` 写的，`traceOf` 读）、`api?: { module?: string; site?: string; fn?: string }`（由 `createApi()` / `apiRoute()` 写）。

**只放每个请求独有的东西**：配置是进程级单例（viper 取值器），日志是进程级单例（`logo`），两者都直接 import，不按请求复制进 context——少一份可变的副本，也少一层"配置从哪来"的追问。

**中间件顺序（库内固定，业务改不了）：**

1. `rid`（请求 id）：入站 header 带了就沿用（`x-rid` 优先，其次网关常见的 `x-request-id`），没带才由 `nextUlid()` 生成 **ULID**（26 位大写 Crockford Base32，见 8.4.1）。写进 `c.set("rid")` 与响应头 `x-rid`。入站值过白名单 `^[0-9A-Za-z._-]{1,64}$`，不合规就当作没带重新生成——它是直接进日志的字段，不加限制等于允许伪造日志行。
2. 兜底日志（见 8.4）：未捕获异常 / 未 finalize / 慢请求，**不是**每请求两行。
3. 解 JWT：从 header 或 cookie 取 token，`hono/jwt` 的 `verify` 校验；失败**不抛**，只把 `uid` 设为 `null` 并记 `authError`。
4. 门禁：命中白名单放行；否则 `uid === null` → `ResponseX.unauthorized(...)`。

兜底日志在门禁之前，401 也有日志；500 由中间件读 `c.error` 记（见 8.4）。

### 8.3 鉴权与白名单

- **白名单不在 `createHonox` 里声明。** `HonoxOptions.auth` 没有 `public` 字段，改由返回的 `HonoxApp.allowAnonymous([...])` 追加，写在挂载接口的地方（示例是 `app/api/index.ts`）。理由：`main.ts` 是装配（配置、rid、Shell、serve），把安全策略塞进去，加一个公开接口就得动两个文件；挂载点本来就是「这里挂了哪些接口」的唯一清单，公开面写在它旁边才只有一处。
- `allowAnonymous` 往门禁持有的**同一个数组引用**里 append，多次调用累加，返回实例本身可链式。门禁每请求读该数组，所以调用后下一个请求就生效（实际发生在模块加载期，早于开始服务）。
- **不提供 `privateRoute` 之类的私有声明。** 默认拒绝已经覆盖「不声明就是受保护」，多一个声明点只多一次忘记的机会。防「有人不小心把接口公开」靠测试：遍历 `app.routes`，断言除白名单外每条裸请求都是 401。
- token 来源：`Authorization: Bearer <token>`（header 名可配）或指定的 cookie（cookie 优先？**header 优先**，cookie 作为兜底）。
- 使用 `hono/jwt` 的 `verify(token, secret, "HS256")`，`exp` 由它校验（过期归为 `authError: "expired"`，无效签名/格式归 `invalid`，没带归 `missing`）。
- 白名单条目两种写法：`"/health"`（任意方法）与 `{ method: "POST", path: "/auth/login" }`（方法精确）。
- 路径匹配支持三种形态，自己写 10 行以内的匹配器，不引路由库：
  - 精确：`/health`
  - 命名段：`/users/:id`（匹配一段非 `/`）
  - 尾通配：`/assets/*`（匹配前缀，且 **`/assets` 本身也算命中**——Hono 的路由语义如此，记忆里已有这条实测结论）
- 白名单默认空数组 = 全部要登录。
- 401 响应：`ResponseX.unauthorized(message)`，`code` 固定 `unauthorized`，message 按 `authError` 区分（「需要登录」/「登录已过期」/「token 无效」）。
- `shell.basePath` 与 `${basePath}/*` 在装配时自动进白名单——控制台有自己的口令鉴权（`SHELL_PASSWORD`），不该被 JWT 门禁挡。

### 8.4 请求日志：业务自写 + 库内兜底

**请求日志由业务自己写，库只兜业务补不了的那几类。** 中间件不再对每个请求无条件打两行：
打不打、打什么、哪些字段要裁掉（密码、超大 body）只有业务知道，中间件在路由匹配之前
也拿不到这些信息。health 这类接口现在就是零日志。

业务侧：

```ts
import { traceOf } from "@needle/honox";

botsApi.post("/bots", BotsBody, (ctx, body) => {
  traceOf(ctx).info({ ids: body.ids });   // 想记什么自己挑
  …
});
```

`traceOf(ctx)` 生成时把 `rid` / `uid` / `path` / `module`（`createApi` / `apiRoute`
注册时写入）取干净，之后打日志不再碰 `ctx`。用的是装配时注入的 logger（`HonoxEnv.Variables.logger`），
没有才退回全局 `logo`——这是「日志不进 request context」那条决策的唯一例外，否则
`createHonox({ logger })` 配的实例会被业务日志绕过。

库兜的四种（业务补不了，没有 handler）：

| 场景 | 位置 | 级别 | 字段 |
|---|---|---|---|
| 401 门禁拒绝 | `auth.ts` 门禁分支 | warn | `rid` `path` `status:401` `authError` |
| 404 未命中 | `createHonox` 装的 `app.notFound` | info | `rid` `path` `status:404` |
| 未捕获异常 | 中间件的计时包装 | error | `rid` `path` `status:500` `durationMs` `uid` `module` + `error`（含栈） |
| 慢请求 | 中间件的计时包装 | warn | 同上一行，但只在无 error 时发 |

- **500 的日志在中间件而不是 `onError`**：业务可以自己 `app.onError`（单槽替换），换掉之后库里的
  日志就没了；`c.error` 是 compose 写的，与谁处理无关。`onError` 只做映射
  （`RequestError` → `ResponseX.fail`；`HTTPException` 自带 `res` 时原样用，否则套 `{code, message}`
  信封、5xx 的 message 换成「服务内部错误」；其它 → `ResponseX.internalError("服务内部错误")`）。
- 非 Error 抛出不进 `onError`（compose 只认 `instanceof Error`），由中间件的 `catch` 记一条后 rethrow。
- `isRequestError` 为真**且状态码 < 500** 时不记 error：客户端传错参数不是服务端故障；
  `RequestError(503, …)` 这类 5xx 仍然留一行。
- `slowMs` 默认 1000ms，`0` 关闭；error 行已带 `durationMs`，慢请求不重复记。

### 8.4.1 id 生成（`@needle/got` 的 `id-tools.ts`）### 8.4.1 id 生成（`@needle/got` 的 `id-tools.ts`）

两种 id，用途不同，都放在 `@needle/got` 的根入口；`@needle/honox` 只消费，**不转手导出**（`import { nextSnowflakeId } from "@needle/got"`）。

#### ULID：`nextUlid()` —— rid 用

**定长 26 位大写 Crockford Base32**，128 位 = 48 位绝对毫秒 + 80 位随机。

- **为什么 rid 不用 Snowflake**：机器号只有 10 位（1024 个桶），MAC / IP 取多少位最后都是哈希进这 1024 个桶——38 个实例就有约 50% 概率撞号（生日悖论）；而序列位每毫秒从 0 开始，撞号的两个实例在同一毫秒各发一个号就是**直接重号**，不是偶发。rid 只用于串日志，不需要紧凑定长，也不需要严格单调，用 80 位随机把「必须配对机器号」这类配置错误整个删掉更划算。
- 80 位随机来自 `crypto.getRandomValues`：同一毫秒撞号概率 2⁻⁸⁰，多进程 / 多实例 / 容器重建都不需要协调。got 不 import `node:`，浏览器与 Workers 也能用。
- 时间位是 **Unix 纪元绝对毫秒**（不是相对自定义 epoch），48 位够到公元 10889 年；越界直接抛错，不静默截断。
- 定长 26 位 → **字典序 = 时间序**（理由见下），但同一毫秒内不保证递增（随机段是乱的）——rid 不需要这个性质。
- 大写是 ULID 规范的样子，第三方 ULID 解析器直接认。

#### Snowflake：`nextSnowflakeId()` / `createSnowflake()` —— 业务实体 id 用

```
0 | 41 位毫秒（相对 epoch） | 10 位机器号 | 12 位序列
```

**对外只有字符串：定长 13 位小写 Crockford Base32**（`0-9a-z` 去掉 `i l o u`）。位运算内部不碰 `bigint`，解析才用。

- 为什么不给 bigint：63 位装不进 JS `number`（`Number.MAX_SAFE_INTEGER` 是 2^53），而 `JSON.stringify(1n)` 直接抛 `TypeError`。让 bigint 出库就得靠每个调用点记得 `String()`——忘一次就是 500 或悄悄截断，这种"靠记性"的约束不该存在。字符串形态写日志、进 JSON、存 Mongo / MySQL 都不用转。
- 为什么定长：变长字符串的字典序 ≠ 数值序（`"9..."` 排在 `"10..."` 前面），新 id 会插到旧 id 之前 → 正是要避免的 B 树回头插 / 页分裂。13 位是 63÷5 向上取整（多出的 2 位恒 0）；ASCII 里 `0-9` 在 `a-z` 之前且字母升序，所以定长小写串直接比大小 = 数值比较。
- **必须全小写**（库只输出小写）；解析侧不区分大小写，人工抄写/网关透传的大写也认得。
- 存储建议：Mongo `_id` 用字符串（13 字节，和 `ObjectId` 的 12 字节同量级）；MySQL 用 `CHAR(13) CHARACTER SET ascii COLLATE ascii_bin`，别用默认的 utf8mb4（索引更宽、大小写不敏感）。
- 参考数字：63 位塞进 signed 64 位没问题（实测 BSON int64 往返精确），但我们**不需要**那条路——字符串形态已经绕开了 JS 精度问题。
- **生成路径不碰 bigint**：`%` / `/` 每次都要分配 bigint 对象，几十万次/秒下全是白烧的 GC。实现把 63 位拆成 hi(31) + lo(32) 两段用 number 位运算，落进一块复用的 `Uint8Array(13)`，最后一次 `String.fromCharCode` 出串——每次调用只产生一个字符串。实测 500k 次：405ns/个 → 244ns/个（约 -40%）。`decode` 仍用 bigint，它只在解析/测试里跑。
- **epoch 必须写死**（`nextSnowflakeId()` 默认 2014-12-09T00:00:00Z）——用启动时间当 epoch 会让每次重启的时间位从 0 开始，id 直接重复。业务要自己的纪元就传 `createSnowflake({ epoch, nodeId })`。
- **机器号**：0..1023。`nextSnowflakeId()` 不传就是机器号 0，**只适用于单实例/单进程**；多实例必须传互不相同的 `nodeId`，从部署配置里显式给（K8s 可用 StatefulSet 序号 / Downward API）。不做「从 MAC / IP 派生」的零配置入口：机器号只有 10 位，MAC 与 pod IP 都是哈希进这 1024 个桶，撞号后同毫秒直接重号；容器重建时 MAC / IP 还会变。
- **生成器要缓存**：序列状态挂在生成器上，`nextSnowflakeId()` 内部按 `epoch:nodeId` 复用同一个实例；每次新建等于每次从序列 0 开始，同一毫秒内连续调用会直接重号。
- **同一毫秒**：序列 +1，超过 4095 就自旋等下一毫秒（不丢号不重号）。
- **时钟回拨**：照原版 Snowflake 直接抛错，不静默产生更小的 id——B 树回头插正是要避免的页分裂。等时钟追上来会让请求卡住，所以不选等待。
- 选型小结：要定长紧凑、严格单调、可解出机器号与序列 → Snowflake；要不配任何东西、多实例随便扩 → ULID。

### 8.4.2 `createApi(module)` / `apiRoute(module, handler)`

一个文件一个组，第一个参数是这个文件在生产日志里的身份：

```ts
// app/api/bots.ts
export const botsApi = createApi("bots.ts");

botsApi.get("/bots", BotsQuery, (ctx, query) => …);     // GET/DELETE → 解析 query
botsApi.post("/bots", BotsBody, (ctx, body) => …);      // POST/PUT/PATCH → 解析 body
botsApi.get("/health", (ctx) => ctx.json({ ok: true })); // 不校验参数

// 已经有 new Hono() 实例时，单独包 handler
app.get("/apc", apiRoute("apc.ts", (c) => …));
```

- **`logModule` 必填**：值是源文件名（`bots.ts`，带扩展名），生产环境唯一的定位信息来源（§8.4.3）；可选就等于允许一批没有身份的日志。
- 带模型的写法：注册时只把 `module` 写进 `c.set("api", …)`（不再抓注册位置）；
  请求到达时按方法决定解析哪一侧（GET/DELETE 读 query，其余读 body），把校验后的对象作为
  handler 的第二个参数。失败抛 `RequestError`，由 `onError` 映射成 4xx。
  代价：一个路由只校验一侧参数（当前没有接口同时需要 query 与 body）。
- 模型的 schema 由 `scripts/gen-models.ts` 从手写 class 生成（见 `2026-10-24-request-log-and-parse-design.md`），
  生成物按类名 `registerModel(...)` 注册，路由这边 `modelSchema(Model)` 懒查；查不到就抛一条
  带修复提示的错误。
- `createApi()` 返回的是真正的 `Hono`（`app.route("/", botsApi)` 照常挂载），只是把
  `get`/`post`/`put`/`patch`/`delete`/`all` 包了一层。
- **Proxy 只绑原型方法**，实例自有字段（`errorHandler` / `notFoundHandler`）原样返回：`bind` 出来
  的副本会让父 app 的 `route()` 误判「子 app 自带错误处理」，把 handler 包进子 app 的**默认**
  errorHandler——父层 `onError` 就再也收不到该组路由的异常（参数校验失败会变成纯文本 500）。

### 8.4.3 调用点与 `module`

**`site` / `fn` 不再逐条从栈里抓。** 打包后栈帧报的是 bundle 坐标（源码直跑是 `bots.ts:39`，
`--outfile` 之后是 `dist/index.js:412`，`--minify` 之后连行号都被挤到第 2 行），逐条构造
`Error` 付了代价却拿不到可用的位置。现在只有 `error` 级构造一次 `Error` 取完整栈，
`info` / `warn` / `debug` 零构造。

生产环境的定位靠**手写一次的源文件名**：`createApi("bots.ts")` / `apiRoute("bots.ts", h)`
里的那个字符串，等于 C++ 里 `LOG_INFO` 宏带的 `__FILE__`。它经 `c.set("api", { module })` 进 context，
由 `traceOf(ctx)` 写进每条业务日志的**行前缀**（JSON 载荷里不再重复；`logo.child({ module })` 是同一件事，给非请求场景用）。

- `captureCallSite()` 已经删除：注册位置不再抓，打包后它同样是 bundle 坐标，从来不是生产定位手段；
  honox 改用 `module` 之后包里也没有别的消费者。
- `callerDepth`（对应 Go 的 `SetFuncCallDepth`）删掉了：它存在的唯一目的是修补「助手包一层
  位置就歪」，自动抓栈没了之后没有意义。
- 行格式是 `日期T时间 [级别] 模块名 载荷`（logo 直调用 payload 给 `site`/`fn` 时仍是
  `文件:行 [函数()]`）；`module` / `site` / `fn` 只在前缀里，不进 JSON。

### 8.5 配置加载（`@needle/honox/node`）### 8.5 配置加载（`@needle/honox/node`）

来源是 rim.server 的 `app/builds/config.go`：`common.yml` 打底 → `app_<env>.yml` 深合并 → 已知环境变量覆盖 → 必填检查，产出一个 viper 风格的取值器。rim 那边调用方写 `vip.GetInt("server.web_port")`，这里对应 `config.getInt("server.web_port")`。

```ts
/** 只认这三种环境；写错的 ENV 启动就报错。 */
export const SUPPORTED_ENVS = ["dev", "fat", "pro"] as const;

export interface LoadConfigOptions {
  dir?: string;                 // 默认 "config"（相对 process.cwd()）
  env?: string;                 // 默认 process.env.ENV ?? "dev"
  envVars?: Record<string, string | undefined>;  // 默认 process.env
  envPrefix?: string;           // 默认 "APP_"
  required?: readonly string[]; // 点分路径
}

export interface Config<C extends Record<string, unknown> = Record<string, unknown>> {
  readonly env: string;         // dev / fat / pro
  isDev(): boolean;
  isFat(): boolean;
  isPro(): boolean;
  has(path: string): boolean;
  get(path: string): unknown;
  getString(path: string, fallback?: string): string;
  getInt(path: string, fallback?: number): number;
  getBool(path: string, fallback?: boolean): boolean;
  getStringMap(path: string): Record<string, string>;
  raw(): C;
}

export function loadConfig<C extends Record<string, unknown>>(options?: LoadConfigOptions): Config<C>;
```

加载顺序（后面的覆盖前面的）：

1. `<dir>/common.yml`——**可缺**，缺失就跳过。
2. `<dir>/app_<env>.yml`——**必存在**，缺失抛 `Error("找不到环境配置：<绝对路径>（ENV=<env>）")`。
3. `APP_*` 环境变量——去掉前缀 → 转小写 → `__` 换成 `.`，写进嵌套路径（`APP_AUTH__SECRET` → `auth.secret`，`APP_SERVER__WEB_PORT` → `server.web_port`）。

规则：

- **`ENV` 只有 `loadConfig` 读**；业务代码一律 `config.getXxx(...)` / `config.isPro()`，不再自己摸 `process.env`（rim 也是这个分工；它另外在 `loadConfigFromEnvironment` 里显式列了 MONGO/REDIS/ROCKETMQ 几个已知变量，我们的对应物是通用 `APP_*`）。
- `ENV` 白名单：`dev` / `fat` / `pro`（大小写不敏感），其它值直接抛。默认 `dev`。
- 读 YAML 用 `yaml`（2.9.1）：它自己不是 `node:` 依赖，但读文件要 `node:fs`，所以 `loadConfig` 只能在 `./node` 入口。
- 深合并语义与 rim 一致：**对象递归合并，数组整体替换**。
- 类型转换（只对环境变量做）：`"true"` / `"false"` → boolean；纯数字串 → number；其余保持字符串。
- 文件顶层必须是对象（或空文件）；否则抛错带路径。空文件当 `{}`。
- 合并后按 `required` 逐条检查（点分路径），缺失或空字符串 → 抛 `Error("配置缺少必填项：auth.secret（来源：config 目录 + 环境变量覆盖）")`。
- **取值语义比 viper 严**：缺值且没给 fallback → 抛 `配置项不存在：<path>`；类型不对 → 抛 `配置项 <path> 类型不对：<原始值>`。viper 返回零值（`""` / `0`），配错时表现成「端口 0」「密钥空」，排查成本比直接报错高。`getStringMap` 缺省给 `{}`（映射类配置本来就可选），值统一 `String()`（YAML 里的数字账号会被转成字符串）。
- `raw()` 给整段透传用。配置不进 request context：任何地方要取值就 `import { viper }`。
- 不引入 zod，也不做 schema 校验；运行时只保证必填项在。

### 8.6 MongoDB（`@needle/honox/mongo`）

```ts
export interface MongoOptions {
  uri: string;
  db?: string;                        // 不传用连接串里的库名（driver 默认行为）
  client?: MongoClient;               // 复用已有连接池时传
}
export interface Mongo {
  readonly client: MongoClient;
  db(): Db;
  withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function createMongo(options: MongoOptions): Mongo;
```

- 连接由 driver 自己管：`new MongoClient(uri)` 在首次操作时才建连，库**不**显式调 `connect()`，也不缓存连接 promise。
- `withTransaction` = `client.withSession(session => session.withTransaction(() => fn(session)))`；transient / unknown-commit 重试交给 driver（它本来就有）。
- `db()` 直接返回 `client.db(options.db)`（不传参数就用连接串里的库名）。
- `close()` 幂等；只关自己建的 client，注入的 `client` 不关。
- 这个入口只在 `./mongo` 出现；根入口与 `./node` 都不 import `mongodb`。

### 8.7 Shell 控制台

只在 `createHonox({ shell })` 里挂，不单独导出 `mountShell`——一个能力一个入口。

- 内部 `createServerShell({ ...options, basePath })`，把 `basePath` 与 `basePath + "/*"` 注册成 `app.all(...)` → `shell.handler(c.req.raw)`。
- 自动加进鉴权白名单（见 8.3）。
- 面板的 `users`、`title`、`version`、`logFiles` 全部由业务传，库不猜。

### 8.8 示例 app（`examples/honox-app`）

**不用 npm 上的 `honox`（HonoX）。** 两个包只共享名字：底座返回的就是 `Hono` 实例，路由直接 `.get()` 挂在它上面，不需要文件路由框架。HonoX 的接法已在 §7 的 spike 里验过并留档，示例不再承担这项演示——带上它要额外拖进 `precinct` → `@typescript-eslint/typescript-estree`，把示例钉在旧 TypeScript 上，也让依赖表里出现两个 `honox`。

**不进 workspace**：示例有自己的 `tsconfig.json`（`moduleResolution: bundler`）与 `bun.lock`，`bun install --frozen-lockfile` 和 Docker 构建要能独立复现。TypeScript 与根同版本（`7.0.2`，由测试钉住）。根 `tsconfig.json` 的 `include` 含 `"examples"`，所以根 tsconfig 保留 `exclude: ["examples/honox-app"]`，让它走自己的 tsconfig。依赖：

- 运行时：`hono`、`@needle/honox`、`@needle/shell`、`@needle/logo`
- 开发：`@types/bun`、`hucre`（生成 Excel 夹具的脚本）、`typescript@7.0.2`
- `@needle/*` 用 `link:` 指到 `../../packages/*`（示例不在根 workspace，`workspace:*` 在独立安装下解析不到；`file:` 同理会把 workspace 依赖断掉）

内容：

```
examples/honox-app/
  app/main.ts            # loadConfig → initLog() → createHonox(...) → registerApis(app) → export default { port, hostname, fetch }
  app/logo.ts            # 日志初始化：级别 + 文件 sink（res/logs）+ 按需飞书，返回 Shell 用的 logFiles
  app/env.ts             # AppConfig（配置形状）+ AppEnv（= HonoxEnv<AppConfig>）
  app/api/               # 一个接口一个文件；index.ts 只做挂载（详见 8.11）
  app/md/                # 一表一文件（bot / apc / select-apc-config），index.ts 持有 manager
  res/config/common.yml  # 所有环境共享（示例里目前是空的）
  res/config/app_dev.yml # 只写与 common 不同的项：端口、shell_users、auth.secret、metadata
  res/config/app_fat.yml # FAT
  res/config/app_pro.yml # PRO：刻意不写 auth.secret，强制 APP_AUTH__SECRET
  res/metadata/*.xlsx    # 模板表（见 8.11）
  Dockerfile
  README.md              # 怎么跑、怎么打镜像
```

**日志在 `app/logo.ts` 里初始化**：读 `logger.filter_level`（写错启动即报错，不静默回退）→ `logo.setLevel` → 挂 `createFileSink({ dir: "log" })` → 配了 `logger.lark_url` 才挂飞书 → 返回 `createLogFiles({ dir: "log" })` 交给 Shell 的 `logFiles`。日志目录固定是工作目录下的 `log/`，不做配置项（它在仓库里是 gitignore 的产物，没有“每个环境不一样”的理由）。挂的是全局 `logo` 实例而不是新建一个：项目里到处 `import { logo }`，两套实例等于一半日志进不了文件也进不了右栏。`minLevel` 跟着 `filter_level` 走，级别不开 debug 就不会凭空多一个空的 `debug.log`。飞书用群机器人的 webhook 地址，地址本身是密钥，仓库里留空、本地用 `APP_LOGGER__LARK_URL` 覆盖。

构建只有一步：`bun build app/main.ts --target=bun --outfile=dist/index.js`。Bun 认得 `export default { port, hostname, fetch }` 并在启动时自己 serve，所以 `dist/index.js` 是自包含产物（npm 依赖已打进去），运行镜像不带 `node_modules`；`res/` 走运行时 fs 读取（配置 + 模板表都在里面），需整目录拷进镜像。配置目录不是库默认的 `config`，示例显式传 `dir: "res/config"`。取值一律走 `config.getInt("server.web_port")` 这类访问器（§8.5），`shell_users` 直接喂给 Shell 面板；没配 `shell_users` 就不挂面板。面板的签名密钥取 `shell.secret`（**必须显式配**：库不给就随机生成，重启后已签发的 token 全废，浏览器 localStorage 里的登录态跟着消失），并且**不复用 `auth.secret`**——两边都是 HS256 + `sub`/`exp`，共用一个密钥等于把面板口令变成业务接口的通行证。token 有效期 7 天（`auth.ttlMs`，库默认 12 小时）。镜像里 `ENV=pro`，`app_pro.yml` 缺 `auth.secret` → 不传 `APP_AUTH__SECRET` 启动即失败。

### 8.10 Excel 元数据（`@needle/honox/excel`）

来源是 rim.proxy 的 `app/unicorn/excel-utils.ts` 与 rim.server 的 `app/md/init_md.go`。取两边的共识，修掉 rim.proxy 的 `size === 0` 当未加载哨兵、`Number(id)` 变 NaN 静默覆盖、同名 sheet 静默覆盖三处 bug。第四处（`constructor.name` 压缩后失效）反过来用了：sheet 名取类名，代价是构建产物必须保留类名，压缩环境要显式传名字——见下面的 bullet。

**目录约定**：启动时扫描一个目录（示例是 `res/metadata`，不递归），按 **sheet 名后缀**分派：

| 后缀 | 类型 | 语义 |
|---|---|---|
| `XxxTemplate` | `Template` | 按 id 取的单条数据；第一层 key 是 sheet 名，第二层是 id |
| `XxxConfig` | `Config` | 全局一份的配置，取第一个非空数据行 |
| 其它 | — | 不是元数据表，跳过并在启动日志里列出 |

两级索引与 rim.server 同构：`routeTable: sheetName → 文件` 是扫描得到的，`templateTable: sheetName → Map<id, row>` 在预载时填好。**代码里不写文件名，也不写加载清单**——新增一张表只要 sheet 名按约定命名，`app/main.ts` 与 `app/md/index.ts` 都不用改。

```ts
export interface Template<T> {
  readonly name: string;
  get(id: number): T | undefined;
  all(): readonly T[];
}

export interface Config<T> {
  readonly name: string;
  get(): T;
}

export interface MetadataReport {
  readonly templates: readonly string[];
  readonly configs: readonly string[];
  readonly skipped: readonly string[];
}

/** 模板类就是 schema：字段默认值决定类型，`[]` 默认值表示该列要拆。 */
export type TemplateClass<T extends object> = new () => T;

export interface Metadata {
  /** 扫描 dir（不递归），整体替换已加载的元数据。 */
  load(dir: string): Promise<MetadataReport>;
  /** 用类当 schema；sheet 名默认取类名。 */
  template<T extends object>(type: TemplateClass<T>, name?: string): Template<T>;
  /** 不带 schema 的重载：Excel 里的值原样返回。 */
  template<T extends Record<string, unknown>>(name: string): Template<T>;
  config<T extends object>(type: TemplateClass<T>, name?: string): Config<T>;
  config<T extends Record<string, unknown>>(name: string): Config<T>;
}

export function createMetadata(): Metadata;
```

- **显式实例，不是模块级全局**：测试各建一个 `createMetadata()`，互不串状态；业务里常见写法是一个模块级 `export const metadata = createMetadata()`，由 `app/md/index.ts` 持有。
- **句柄可以比 `load()` 先建**：`app/md/*.ts` 在导入期就 `metadata.template("BotTemplate")`，真正的数据在 `load()` 之后可读；未加载就取 → 抛「元数据尚未加载」。
- **绑定不用类名**：Go 靠反射拿类型名当 sheet 名，TS 拿不到，所以 sheet 名显式写在 `template()` / `config()` 的参数里（大写原样，与文件里的 sheet 名逐字一致）。打包压缩不影响。
- **启动预载**：`await metadata.load(config.metadata.base_url)` 一次。之后 getter 同步、零 IO。原因是 hucre 只能异步读（`DecompressionStream` 解 zip，见 §10）。
- **原子加载**：先建新的表，全部成功才替换；任一 sheet 出错整体抛，旧的已加载状态不变（可重试）。
- 同一文件只解析一次 zip，按绝对路径缓存 workbook。
- 表头：首行 `trim().toLowerCase()`；`id` 只接受数字：缺 `id` 或非数字 → 抛错，消息带 `文件#sheet`、Excel 行号（1 基，含表头）与原始值；重复 `id` → 抛错；**同名 sheet 出现在两个文件里 → 抛错**（第一层索引只能用 sheet 名，必须唯一）。行对象原样保留多余列。
- `Config` 取第一个非空数据行（与 go-excel 读单结构体同口径）；整张表没有数据行 → 抛错。
- **类即 schema（拆列）**：TS 的类型在运行时全被擦掉，`equips: string[]` 编译后什么都不剩，所以"数组就拆"必须落在运行时可读的地方——模板类字段的默认值正好是。`equips: string[] = []` 表示该列按 `|` 拆成 `string[]`；非数组字段原样返回（值里带 `|` 也不动）。逐列换分隔符用静态字段 `static separators = { tags: "," }`（写 `""` 等同默认 `|`）。`"0"` 保留（配置表里它是"该槽位空"的占位），元素 `trim()`，空单元格给 `[]`；表里没这列就跳过，不造幽灵字段。
- **sheet 名取类名**：`metadata.template(ApcTemplate)` 对应 sheet `ApcTemplate`，与 rim.proxy / Go 的反射取类型名同构。代价是压缩产物里 `class.name` 会被抹平——**示例的 `bun build` 不开 `--minify`**；真要在压缩环境用，显式补第二个参数 `metadata.template(ApcTemplate, "ApcTemplate")`，或者退回只传 sheet 名的重载（不做拆列）。
- 拆列视图按句柄缓存，`load()` 递增版本号让缓存失效。
- 扫描只认 `.xlsx` / `.xlsm`，按文件名排序遍历（报错与日志稳定）。

### 8.11 示例里的 Excel

`res/metadata/` 下两张 xlsx、三张 sheet，全部靠 sheet 名后缀被自动发现：

| 文件 | sheet | 类型 | 列 |
|---|---|---|---|
| `BotTemplate.xlsx` | `BotTemplate` | Template | `id` / `name` / `prompt` |
| `ApcTemplate.xlsx` | `ApcTemplate` | Template | `id` / `equips`（split → `string[]`）/ `gender` / `name` / `buy_money` / `buy_price` |
| `ApcTemplate.xlsx` | `SelectApcConfig` | Config | `select_apc1..4`（各自 split → `string[]`） |

布局照 rim.server：一张表对应 `app/md/` 下一个文件（kebab-case），文件里只声明**类型 + sheet 名**，没有文件名也没有注册清单。

- `app/md/index.ts`：`export const metadata = createMetadata()` + `initTemplates(dir)`（调用 `metadata.load(dir)` 并按 report 打一行启动日志）。
- `app/md/bot-template.ts` / `apc-template.ts`：类（`id = 0`、`name = ""`…）+ 文件内私有 `const templates = metadata.template(XxxTemplate)` + `getXxx(id)` / `getXxxs()`；`apc-template` 的 `equips: string[] = []` 就是拆列声明。
- `app/md/select-apc-config.ts`：类（四个 `string[] = []` 字段）+ 私有 `const config = metadata.config(SelectApcConfig)` + `getSelectApcConfig()`（Config 只有一份，没有复数形式）。
- 约定：句柄不导出，每个文件只出「类 + 单条 getter + 全表 getter」，调用方按需 import 具体文件，不经 `index.ts` 转手（否则新增表又要改 index）。
- `app/main.ts`：`await initTemplates(config.metadata.base_url)`（示例配置里是 `res/metadata`）。

**新增一张表 = 在 `app/md/` 加一个文件**（需要路由就再加一个 `app.get`）；`index.ts` 与 `app/main.ts` 的模板相关代码都不用动。

HTTP 接口按 `app/api/<name>.ts` 一接口一文件（照 rim.server 的 `app/web/controller/*.go` 分文件思路，但这里粒度到单个接口），`app/api/index.ts` 的 `registerApis(app)` 只做登记，`app/main.ts` 不再出现具体路由。接口类型用 `app/env.ts` 导出的 `AppEnv`（= `HonoxEnv<AppConfig>`）。

参数走 query 而不是路径段：`GET /bots?id=1`、`GET /apc?id=1` 取单条，不带 `id` 返回全表，`id` 非数字 → `ResponseX.badRequest(...)`，查不到 → `ResponseX.notFound(...)`；`GET /select-apc` 返回那份 Config。理由：id 是可选筛选条件，不是资源路径的一部分。

中间件链（rid → 兜底日志 → JWT）由 `createHonox()` 统一装在本库路由之前，因此每个 API 都自动拿到 `c.get("uid")`；请求日志由业务用 `traceOf(ctx)` 自己写（见 8.4）。表不用脚本生成，直接用 Excel 维护。

注意：`metadata.base_url` 目前只支持本地目录。`app_fat.yml` 里它是 https 地址（rim.server 用来拉远端元数据），本库还没做远端拉取，跑 `ENV=fat` 会在加载时报目录不存在。

### 8.12 仓库接线

- 根 `package.json`：`build:honox`（排在 `build:shell` 之后），并加进 `build` 链。
- 各包 `tsconfig.build.json` 开 `declarationMap`：dist 是提交进仓库的，`exports.types` 指到 `dist/*.d.ts`；没有 map 时编辑器只能跳到 `.d.ts`，有 map 才落到 `src/*.ts`。`.map` 与 dist 一起提交。
- `scripts/sync-version.ts`：包清单从根 `workspaces` 的 glob 推导，新增包自动纳入（`scripts/workspaces.ts`）。
- `test/version-lock.test.ts`：把 honox 纳入「各包版本 == 根版本」。
- `packages/shell/test/no-hono-coupling.test.ts`：按 §6 收窄口径（core/logo/shell 不变 + honox 例外），依赖图与入口表补 honox。
- 根 `tsconfig.json`：`exclude: ["examples/honox-app"]`。
- README 包表格加一行：`@needle/honox` / `@needle/honox/node` / `@needle/honox/mongo` / `@needle/honox/excel` 各自能跑在哪。
- 合并进 main 时根 `package.json` patch +1（0.3.11 → 0.3.12），随分支最后一个提交。
- 完成后在 `docs/01.memory.md` 记一条关键决策（含 HonoX + TS 7 的坑）。

## 9. 测试

`packages/honox/test/`：

| 文件 | 覆盖 |
|---|---|
| `id.test.ts`（已搬到 `packages/got/test/id-tools.test.ts`） | 位布局可解回三段；同毫秒序列递增；跨毫秒归零且整体递增；4096 个后等下一毫秒；时钟回拨抛错；不同 nodeId 不撞；nodeId 越界与早于 epoch 报错；ULID 位布局/字典序/同毫秒不重复/时间越界；`nextSnowflakeId()` 默认参数与生成器缓存 |
| `auth.test.ts` | 有效 token 放行；缺失 / 无效 / 过期 → 401 且 code=unauthorized；白名单精确匹配与 method 限定；`:id` 与 `/*` 匹配（含基路径本身）；cookie 取 token；`claim` 可配 |
| `middleware.test.ts` | 401 / 404 / 500 / 慢请求各一条且字段正确；业务自装 onError 仍有 500 日志；RequestError 不记 error；不写日志的路由零日志 |
| `config.test.ts` | `common.yml` 缺失时跳过；`app_<env>.yml` 缺失时报错带路径与 ENV 值；深合并（对象递归、数组整体替换）；`APP_*` 覆盖嵌套字段；true/false/数字转换；`required` 缺失报错带字段路径 |
| `mongo.test.ts` | `db()` 透传库名（不传时用连接串默认）；`withTransaction` 把 session 传给回调；`close()` 幂等；注入的 client 不被 close |
| `shell-mount.test.ts` | `/shell` 返回 HTML；`/shell/*` 可用；白名单生效（不带 token 也能访问） |
| `excel.test.ts` | 后缀分派（Template / Config / 跳过）与 `report`；表头大小写/空格归一；空行跳过；`get` / `all`；缺 id、非数字 id、重复 id 各自抛错且消息带 `文件#sheet` + 行号；同名 sheet 跨文件冲突；未加载时 getter 抛；名字写错列已加载项；句柄先于 `load()` 建立；重复 `load()` 整体替换；目录不存在；同一文件多 sheet；类 schema 拆列（数组字段才拆、非数组字段不动、trim、保留 0、空单元格 → `[]`、static separators、Config 也拆、重新 load 后视图刷新、只传 sheet 名时不拆） || `entry.test.ts` | `exports` 四个入口都指向真实 dist 文件；按包名能拿到 `createHonox` / `loadConfig` / `createMongo` / `createMetadata` |
| `browser-safety.test.ts` | `./` 入口 `Bun.build({ target: "browser" })` 产物不含 `node:` / `require(` / `import(`（照抄 shell 的写法） |

Mongo 测试用结构化 fake（`as unknown as MongoClient`），不依赖真实 mongod，不引 `mongodb-memory-server`。`mongodb` 进 devDependencies 供类型检查。

**依赖解析（重要）：**根 `package.json` 不加 `hono`——`hono` 与 `mongodb` 写在 `packages/honox/package.json` 的 `devDependencies`（同时 hono 是 `peerDependencies: {"hono":"^4"}`），workspace 安装会提升到根 `node_modules`，`packages/honox/src` 因此能解析到类型，而根与三个旧包的依赖表保持干净。这是 §6 那条「no-hono」收窄后仍然成立的前提。

**变异测试（mutation test）**：`bun run mutate` → `stryker run --inPlace`，配置在根 `stryker.conf.json`。

- 变异的是 `packages/honox/src/{auth,config,excel,id,middleware,mongo,node,route}.ts`，测试命令是 `bun test packages/honox/test`（只跑这个包，1.8 分钟跑完 ~880 个变异体）。
- **必须 `--inPlace`**：仓库根是 TypeScript 7.0.2（原生版），Stryker 的沙盒会给 tsconfig 做预处理、调 `ts.parseConfigFileTextToJson`——这个 API 在 TS 7 里没有，直接崩。`--inPlace` 跳过沙盒（也就跳过那段预处理），改完自动从 `.stryker-tmp/backup-*` 还原。
- **测试要 import `../src/*`**：从包名（`@needle/honox/excel`）导入会解析到 `dist/`，变异源码根本影响不到测试——这类文件的分母会变成 0 分（早期 config.ts 就是这样暴露的）。所以 config / excel / mongo 的测试改成直接 import `../src/`；`entry.test.ts` / `browser-safety.test.ts` 这类**故意**验证产物的测试保持用包名。
- 当前分数 82.33%（`middleware.ts` 95.65、`config.ts` 85.22、`excel.ts` 82.03、`auth.ts` 76.30、`route.ts` 75.86、`node.ts` 69.51、`mongo.ts` 71.43），阈值 `break: 80`。id 生成已搬到 `@needle/got`，未重跑本包变异测试。
- 剩下的存活变异体主要是两类：错误消息里的字符串（改了也测不出来），以及"等价变异"（`?.` 换成 `.`、`typeof x === "function" ? x.bind(t) : x` 的三个分支——传进来的本来就是函数）。要再往上抬就得为这些等价物补"反直觉"的测试，性价比低。

**验收命令**（沿用根 VERIFY，不改）：

```
bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs
```

示例 app 不进 merge 门禁（要独立装依赖、要网络）。单独验收：`bun run example:build` → 构建通过；再手动 `bun run example` 起服务，curl `/health`、`/me`、`/shell`；有 docker 的机器上 `docker build` 一次。

## 10. 风险与待实测

1. **`/shell/*` 是否匹配基路径 `/shell`**：记忆里已有 Hono 的实测结论（匹配），实现时仍用测试钉住；不匹配就补一条精确路由。
2. **shell 面板的 sink 没有 dispose 出口（已定：接受）。** `shell/src/source.ts:123` 把广播 sink `addSink` 到传入的 logger（默认全局 `logo`），只有 `ServerShell.dispose()` 才摘；B 只返回裸 Hono，没有这个出口。人类拍板保持返回形状不变，文档写明「一个进程一个实例」：测试每次传独立 logger 做隔离，生产里只在开发热重载时积 sink。`sse.ts` 的定时器跟连接走、`teardown` 会清，不会挂住测试。
3. **示例 app 用 `file:` 还是 `bun link` 接 workspace 包**：以 `bun install --frozen-lockfile` 能在干净目录跑通为准。
4. **构建步骤**：示例没有客户端入口，构建只有 `bun build` 一步（不再有 vite 的 SSR/client 两次构建）；将来加 islands 或静态资源再补。
5. **hucre 没有同步 API（已核实）。** `readXlsx` 返回 `Promise`，因为它用 `DecompressionStream("deflate-raw")` 解 zip（`hucre/dist/zip/reader.mjs`），这个 Web API 天生异步；零依赖所以没带同步 inflate。`@jetstreamapp/simple-excel` 同样是流式异步。所以选「启动预载 + 同步 getter」：预载在启动路径上多花一次解析时间，换来业务侧不用改调用形态。
6. **Excel 测试夹具由 hucre 自己写出来**（`writeXlsxObjects`），读和写是同一家实现，存在「自己读自己写的格式」的自证实风险。缓解：夹具里手工塞入大小写表头、空行、坏 id 行等边界；若线上出现 hucre 解析问题，再补一个真实 Excel 导出的夹具。

## 11. 留给实现者决定

- 白名单匹配器的具体实现（正则 vs 手写分段比较），只要满足 8.3 的三条语义并有测试。
- 日志字段的排列与消息文案。
- 中间件文件怎么拆、哪些函数内部可见；只要公开 API 与 8.2 一致。
- 示例 app 的目录细节、README 措辞、Dockerfile 分层（单阶段够用即可）。
- YAML 读取失败（语法错）的错误文案。
