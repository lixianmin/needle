# @needle/honox 设计

日期：2026-10-24
状态：待人类批准

## 1. 结论

在 `packages/honox` 新增 `@needle/honox`：一个跟业务无关的 Hono 底座。它做四件事——配置加载、鉴权、每请求日志、可选 MongoDB——外加把 `@needle/shell` 的控制台挂上去。示例 app 放在 `examples/honox-app`（纯 Hono + `bun build` + Dockerfile），用来说明它怎么接。

库本身**不 import honox**，也不用 npm 上的 `honox`（HonoX）：底座返回的就是 `Hono` 实例，路由直接挂在上面。业务若真要 HonoX 的文件路由/islands，自行 `createApp({ app: createHonox(...) })` 接入（验证见 §7）。

## 2. 为什么

每起一个新项目都要重写一遍同样的东西：读配置、解 JWT、按接口挂鉴权、每请求打日志、连 Mongo、挂调试面板。抄来抄去不但慢，而且每次都抄得不一样——A 项目的 401 返回 `{error}`，B 项目返回 `{code, message}`；A 项目默认放行，B 项目默认拒绝。

把这一层固化成包，新项目 `import` 就开工，行为口径全仓库一套。本仓库已有 `@needle/logo`（日志）和 `@needle/shell`（控制台），正好是这一层的天然依赖。

## 3. 目标

- 新项目三行代码拿到：配置对象、每请求日志、JWT 鉴权、可选 Mongo 连接池。
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
- **TypeScript 7 与 HonoX 不兼容（已实测）**：honox 0.1.62 的岛检测经 `precinct` → `@typescript-eslint/typescript-estree` 调用 TS API，在 TS 7.0.2 上抛 `TypeError: Cannot read properties of undefined (reading 'Cjs')`，vite 连配置都加载不了；换 5.9.3 立即通过。仓库根是 TS 7.0.2，所以示例 app 必须独立安装、不进 workspace。
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
| **`hucre` + 启动预载，getter 保持同步** | **选中**：`await loadSheets([...])` 一次，之后同步零 IO，业务侧与 rim.proxy 形态一致；代价是启动时多一次解析 |

hucre 选它而不是 simple-excel：配置表就几张、几千行，用不上流式；`hucre/xlsx` 读路径约 34 KB gzip，simple-excel 是 508 KB 的流式引擎。

## 8. 设计

### 8.1 包结构与入口

```
packages/honox/
  package.json          # exports: "." / "./node" / "./mongo" / "./excel"
  src/index.ts          # createHonox + 类型（无 node:）
  src/auth.ts           # JWT 解析 + 门禁 + 白名单匹配
  src/request-log.ts    # 每请求日志中间件
  src/config.ts         # 合并/必填检查（纯逻辑，node 入口复用）
  src/node.ts           # loadConfig（读 YAML）
  src/mongo.ts          # createMongo / withTransaction
  src/excel.ts          # defineSheet / loadSheets（读 Excel）
  test/*.test.ts
  tsconfig.build.json
```

- `dependencies`：`@needle/shell`、`@needle/logo`（workspace）、`yaml`（读 YAML）、`hucre`（读 Excel；只在 `./excel` 入口被 import）。
- `peerDependencies`：`hono: "^4"`；`mongodb` 为 **optional peer**（`peerDependenciesMeta`），不装就不会被打包。
- **不依赖** `honox`、`vite`。

### 8.2 `createHonox(options)`

```ts
export interface HonoxOptions<C extends Record<string, unknown>> {
  config: C;
  log?: Logger;                              // 默认 @needle/logo 的 logo 实例
  auth: {
    secret: string;                          // HS256 密钥
    claim?: string;                          // uid 取哪个 claim，默认 "sub"
    header?: string;                         // 默认 "authorization"（Bearer xxx）
    cookie?: string;                         // 可选：从 cookie 读 token（如 "token"）
    public?: readonly (string | { method: string; path: string })[];
  };
  shell?: ServerShellOptions;                // 传了就把控制台挂到 shell.basePath（默认 "/shell"）
}

export function createHonox<C extends Record<string, unknown>>(
  options: HonoxOptions<C>,
): Hono<HonoxEnv<C>>;
```

`HonoxEnv<C>` 的 Variables：`uid: string | null`、`user: JwtPayload | null`、`authError: "missing" | "invalid" | "expired" | null`、`config: C`、`log: Logger`、`reqId: string`。

**中间件顺序（库内固定，业务改不了）：**

1. `reqId`：`crypto.randomUUID()`，写进 `c.set("reqId")` 与响应头 `x-request-id`。
2. 每请求日志（见 8.4）。
3. 解 JWT：从 header 或 cookie 取 token，`hono/jwt` 的 `verify` 校验；失败**不抛**，只把 `uid` 设为 `null` 并记 `authError`。
4. 门禁：命中白名单放行；否则 `uid === null` → `ResponseX.unauthorized(...)`。

日志在门禁之前，401 也有 `<--` 结束行；`finally` 保证抛错也落一行。

### 8.3 鉴权与白名单

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

### 8.4 每请求日志

两个方向各一行，走 `log.child({ req: reqId })`：

```
--> GET /orders uid=-                     # 开始
<-- GET /orders 200 12ms uid=u1           # 结束（status、耗时、uid）
```

- 结束行的 `uid` 取请求结束时的值（门禁/路由里可能已经解析出用户）。
- 抛错：`log.error({ err: { message, stack } })` 记一条，然后**原样 rethrow**，交给业务的 `app.onError` 或 Hono 默认处理；`finally` 仍落 `<--`（此时 status 是 500）。
- 结构化字段：`method`、`path`、`status`、`durationMs`、`uid`、`req`。

### 8.5 配置加载（`@needle/honox/node`）

来源是 rim.proxy 的 `app/config/config.ts`：`common.yml` 打底 → `app_<env>.yml` 深合并 → 环境变量覆盖 → 必填检查。

```ts
export interface LoadConfigOptions {
  /** 配置目录（相对 process.cwd()），默认 "config" */
  dir?: string;
  /** 环境名，默认 process.env.ENV ?? "dev"；小写后拼文件名 */
  env?: string;
  /** 环境变量源，默认 process.env */
  envVars?: Record<string, string | undefined>;
  /** 环境变量前缀，默认 "APP_" */
  envPrefix?: string;
  /** 必填路径，如 ["auth.secret"] */
  required?: readonly string[];
}

export function loadConfig<C extends Record<string, unknown>>(options?: LoadConfigOptions): C;
```

加载顺序（后面的覆盖前面的）：

1. `<dir>/common.yml`——**可缺**，缺失就跳过。
2. `<dir>/app_<env>.yml`——**必存在**，缺失抛 `Error("找不到环境配置：<绝对路径>（ENV=<env>）")`。
3. `APP_*` 环境变量——去掉前缀 → 转小写 → `__` 换成 `.`，写进嵌套路径（`APP_AUTH__SECRET` → `auth.secret`）。

规则：

- 读 YAML 用 `yaml`（2.9.1）：它自己不是 `node:` 依赖，但读文件要 `node:fs`，所以 `loadConfig` 只能在 `./node` 入口。
- 深合并语义与 rim.proxy 一致：**对象递归合并，数组整体替换**。
- 类型转换（只对环境变量做）：`"true"` / `"false"` → boolean；纯数字串 → number；其余保持字符串。
- 文件顶层必须是对象（或空文件）；否则抛错带路径。空文件当 `{}`。
- `env` **不做白名单**：任何值都直接用小写拼文件名。写错环境名就是文件不存在，报错里带 ENV 值。
- 合并后按 `required` 逐条检查（点分路径），缺失或空字符串 → 抛 `Error("配置缺少必填项：auth.secret（来源：config/common.yml + config/app_dev.yml + APP_ 环境变量）")`。
- 返回普通对象，用泛型声明形状，不提供 `get('a.b')` 访问器。
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
  app/server.ts          # loadConfig → createHonox(...) → 路由直接挂 → export default { port, fetch }
  app/md/                # 一表一文件：bot-template.ts / apc-template.ts，index.ts 统一预载
  config/common.yml      # auth.secret
  config/app_dev.yml     # 只写与 common 不同的项
  Dockerfile
  README.md              # 怎么跑、怎么打镜像
```

构建只有一步：`bun build app/server.ts --target=bun --outfile=dist/index.js`。Bun 认得 `export default { port, fetch }` 并在启动时自己 serve，所以 `dist/index.js` 是自包含产物（npm 依赖已打进去），运行镜像不带 `node_modules`；`config/` 与 `res/` 走运行时 fs 读取，仍需拷进镜像。

### 8.10 Excel 配置（`@needle/honox/excel`）

来源是 rim.proxy 的 `app/unicorn/excel-utils.ts`：一张 sheet ↔ 一个模型、首行当表头（小写 + trim）、按 `id` 建索引、每个 sheet 一个 `getXxx(id)`。保留这套习惯，修掉它的四处 bug（`constructor.name` 压缩后失效、`size === 0` 当未加载哨兵、`Number(id)` 变 NaN 静默覆盖、同名 sheet 静默覆盖）。

```ts
export interface SheetOptions {
  /** xlsx 路径；相对路径按 process.cwd() 解析 */
  file: string;
  /** sheet 名；不给就用文件名去掉扩展名 */
  sheet?: string;
  /** id 列名，默认 "id" */
  id?: string;
}

export interface Sheet<T> {
  readonly name: string;
  /** 未预载时抛错；找不到返回 undefined。 */
  get(id: number): T | undefined;
  all(): readonly T[];
  /** 幂等；失败不留半加载状态。 */
  load(): Promise<void>;
}

export function defineSheet<T extends Record<string, unknown>>(options: SheetOptions): Sheet<T>;
/** 批量预载：逐个调 load()，任一失败则抛。 */
export async function loadSheets(sheets: readonly Sheet<unknown>[]): Promise<void>;
```

- **绑定不用类名**：sheet 名显式写在 `defineSheet` 里（默认取文件名），模型只是泛型参数——运行时不 `new` 任何东西，打包压缩不影响。业务侧是 `const bot = botSheet.get(1)`。
- **启动预载**：入口处 `await loadSheets([botSheet, textSheet])` 一次（HonoX 的 `app/server.ts` 顶层 await）。之后 getter 同步、零 IO。未预载就调 getter → 抛「Excel 尚未加载：先 await loadSheets()」。原因是 hucre 只能异步读（它用 `DecompressionStream` 解 xlsx 的 zip，见 §10）。
- **没有全局注册表**：要加载哪些 sheet 由调用方列出来。好处是测试之间不串状态、多一份 sheet 不需隐式约定；代价是入口处多一行清单。
- 同一文件只读一次：按解析后的绝对路径分组，读一次 workbook 后取各 sheet。
- 表头：首行，`trim().toLowerCase()`（用 hucre `readXlsxObjects` 的 `transformHeader` + `skipEmptyRows: true`）。
- `id` 只接受数字：缺 `id` 或非数字 → 抛错，消息带文件、sheet、Excel 行号（1 基，含表头）与原始值；重复 `id` → 抛错。行对象原样保留多余列。
- sheet 名没写时取文件名；注册的 sheet 不存在 → 抛错。
- 加载是原子的：任一 sheet 出错就整个 `load()` 抛，已加载状态不变（下次可重试）。
- 导入用 `import { readXlsxObjects } from "hucre/xlsx"`（子入口，读 xlsx 约 34 KB gzip）。

### 8.11 示例里的 Excel

示例 app 带两张表：`res/metadata/BotTemplate.xlsx`（sheet `BotTemplate`，列 `id` / `name` / `prompt`）与 `res/metadata/ApcTemplate.xlsx`（sheet `ApcTemplate`，列 `id` / `equips` / `gender` / `name` / `buy_money` / `buy_price`；`equips` 是 `|` 分隔的装备 id 串，原样当字符串返回）。

布局照 rim.proxy：`res/metadata/` 下一张表对应 `app/md/` 下一个文件，文件名 kebab-case。每个文件导出 `XxxTemplate` 类型、`defineSheet` 句柄和 `getXxxTemplate(id)` getter；`app/md/index.ts` 集中 `initTemplates()`（`await loadSheets([botTemplate, apcTemplate])`）并转出 getter。`app/server.ts` 只调 `await initTemplates()`，新增表不改它。

`GET /bots/:id` 与 `GET /apc/:id` 各自调 `getXxxTemplate(Number(c.req.param("id")))`；找不到 id 返回 `ResponseX.notFound(...)`。`ApcTemplate.xlsx` 里另有一张 `SelectApcConfig`（无 `id` 列），不归 `defineSheet` 管，不加载。表不用脚本生成，直接用 Excel 维护。

### 8.12 仓库接线

- 根 `package.json`：`build:honox`（排在 `build:shell` 之后），并加进 `build` 链。
- `scripts/sync-version.mjs`：targets 加 `packages/honox/package.json`。
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
| `auth.test.ts` | 有效 token 放行；缺失 / 无效 / 过期 → 401 且 code=unauthorized；白名单精确匹配与 method 限定；`:id` 与 `/*` 匹配（含基路径本身）；cookie 取 token；`claim` 可配 |
| `request-log.test.ts` | 两行（`-->` / `<--`）；401 也有结束行；handler 抛错 → 落 error 且 rethrow、结束行 status 500；响应头有 `x-request-id` |
| `config.test.ts` | `common.yml` 缺失时跳过；`app_<env>.yml` 缺失时报错带路径与 ENV 值；深合并（对象递归、数组整体替换）；`APP_*` 覆盖嵌套字段；true/false/数字转换；`required` 缺失报错带字段路径 |
| `mongo.test.ts` | `db()` 透传库名（不传时用连接串默认）；`withTransaction` 把 session 传给回调；`close()` 幂等；注入的 client 不被 close |
| `shell-mount.test.ts` | `/shell` 返回 HTML；`/shell/*` 可用；白名单生效（不带 token 也能访问） |
| `excel.test.ts` | 表头大小写/空格归一；空行跳过；`get` / `all`；缺 id、非数字 id、重复 id 各自抛错且消息带行号；未预载时 getter 抛；同一文件的多个 sheet 都能读；注册不存在的 sheet 抛；文件缺失抛带路径 || `entry.test.ts` | `exports` 四个入口都指向真实 dist 文件；按包名能拿到 `createHonox` / `loadConfig` / `createMongo` / `defineSheet` |
| `browser-safety.test.ts` | `./` 入口 `Bun.build({ target: "browser" })` 产物不含 `node:` / `require(` / `import(`（照抄 shell 的写法） |

Mongo 测试用结构化 fake（`as unknown as MongoClient`），不依赖真实 mongod，不引 `mongodb-memory-server`。`mongodb` 进 devDependencies 供类型检查。

**依赖解析（重要）：**根 `package.json` 不加 `hono`——`hono` 与 `mongodb` 写在 `packages/honox/package.json` 的 `devDependencies`（同时 hono 是 `peerDependencies: {"hono":"^4"}`），workspace 安装会提升到根 `node_modules`，`packages/honox/src` 因此能解析到类型，而根与三个旧包的依赖表保持干净。这是 §6 那条「no-hono」收窄后仍然成立的前提。

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
- 日志字段的排列与消息文案（`-->` / `<--` 的形状固定）。
- 中间件文件怎么拆、哪些函数内部可见；只要公开 API 与 8.2 一致。
- 示例 app 的目录细节、README 措辞、Dockerfile 分层（单阶段够用即可）。
- YAML 读取失败（语法错）的错误文案。
