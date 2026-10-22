# logo 设计文档

日期：2026-10-22
状态：草案（待人类确认）

## 1. 背景

线上出问题时的现状是：`docker exec -it <容器> sh`，然后在终端里 `tail -f`、`grep`、`ps`。用户体验差，只能在有 shell 权限的机器上做，查完就丢。

对标项目 [gonsole](https://github.com/lixianmin/gonsole) 用 Go 解决了这件事：进程内嵌一个远程控制台，浏览器里敲命令、看日志、看指标。本项目把那部分搬到 TypeScript，只搬"浏览器调试自己"这一块，不搬游戏长连接框架。

日志部分对标 [lixianmin/logo](https://github.com/lixianmin/logo) 的 API 形态（`Info/Warn/Error/Debug` + JSON 结构化），但按 JavaScript 的习惯调整。

## 2. 目标

1. 一个包，挂在任意 Node 服务的 HTTP 上，浏览器打开就有终端样式的控制台。
2. 浏览器里能做三件事：看实时日志、敲命令看结果、订阅周期性指标推送。
3. 日志默认 JSON，可同时写 stdout、文件、飞书群。
4. 同一份代码能在 Cloudflare Workers 上 import 并运行——不需要改代码、不需要为 Workers 维护一份分支实现（部署参数如 `secret` 另行传入）。
5. 零运行时依赖，包体尽量小。
6. 代码本身是一份可读的教材：模块小、命名说人话、注释解释"为什么"。

## 3. 非目标

- 通用 RPC 框架。不做 TCP 监听、不做自定义二进制协议、不做客户端 SDK。
- 多租户、审计、RBAC。鉴权只到"匿名/登录"两档。
- 日志聚合平台。不做检索、索引、长期存储。
- 浏览器里的终端模拟器（xterm）。用简单列表呈现输出。
- Workers 上跨 isolate 的日志汇聚。见 §10。

## 4. 约束

| 项 | 取值 |
|---|---|
| 语言 | TypeScript 7.0.2（native tsc），`strict` |
| 开发与测试 | Bun 1.4 |
| 运行时（生产） | Node.js（≥ 20），Cloudflare Workers |
| 依赖 | 运行时零依赖；`ws`、Hono、任何框架都不作为依赖。devDependency 里引入 miniflare 用于 Workers 集成测试 |
| 传输 | SSE（服务端推送）+ POST（命令请求/响应） |

选 SSE 而非 WebSocket 的原因：WebSocket 在每个运行时都需要宿主额外接线（Node 要 `ws` + `noServer`、Bun 要在 `serve()` 时传 `websocket` 选项、Workers 必须有 Durable Object 并改 wrangler 配置）；SSE 只要一个 `(Request) => Response` 的 handler，三个运行时零配置。Workers 的 HTTP 请求没有 wall time 上限，客户端连着就能一直 stream，所以 SSE 在 Workers 上不需要 DO。

## 5. 总体结构

一个 npm 包，四个入口。核心入口不认识任何运行时 API。

```
.             → logo 日志门面（默认入口）
./console     → 控制台：kernel + HTTP/SSE 适配器 + 可挂载的 UI
./node        → 文件 sink、Node HTTP 挂载助手、Node 指标
./lark        → 飞书 sink
```

控制台分两层，因为它的宿主不止服务器：

```
createConsoleSource()   → 纯逻辑：命令注册、exec、主题、环形缓冲、鉴权
      ↓ 同一个 source
createConsole(source)   → (Request) => Response，给 Node / Bun / Workers
mountConsole(el, source) → 直接挂到页面 DOM，给浏览器与扩展
```

UI 只有一份实现（`src/console/ui/view.ts`，DOM 构建 + Solarized Dark 样式）。服务端要吐 HTML，所以构建时用 `scripts/build-ui.mjs` 把 `ui/app.ts` 打包成字符串常量（`ui/script.generated.ts`），页面模板直接内联它。浏览器/扩展场景直接 import `mountConsole`，不走字符串、不走 eval——扩展的 CSP 不允许内联脚本，这条路必须干净。

`core` 的入口只使用 `fetch`、`crypto.subtle`、`TextEncoder` 这些跨运行时 API。唯一的例外是 `core/logo/sinks/file.ts`：它依赖 `node:fs`，因此**只从 `./node` 入口导出**，`.  ` 入口不会把它拉进包里（Workers 集成测试会断言产物里没有 `node:`）。`node` 入口里的 `node:fs` 用静态 import——那个入口本来就只有 Node 会加载。

## 6. 日志 API

### 6.1 方法

```ts
logo.debug(...args)
logo.info(...args)
logo.warn(...args)
logo.error(...args)

logo.child(fields)      // 返回派生 logger，自动带上 fields
logo.addSink(sink)
logo.removeSink(sink)
logo.setLevel(level)
logo.flush()            // 立即写出缓冲区
logo.dispose()          // flush + 关掉定时器 + 调用 sink 的 close（如果有）
```

只有四个级别方法，没有 `jsonI`/`jsonD` 这类第二套接口。对象直接传进去就行。

### 6.2 参数规则

字符串、数字、布尔、`undefined`、`null` 拼接成 `msg`，用单个空格分隔，与 `console.info` 一致。

对象（含数组、`Error`）不拼进 `msg`，而是合并进记录的顶层字段。`Error` 展开成 `{ message, stack }`。多个对象按顺序合并，后者覆盖前者的同名键。

```ts
logo.info("order created", { orderId: 42, amount: 99 })
// {"time":1758991234567,"level":"info","msg":"order created","orderId":42,"amount":99}

logo.info({ orderId: 42 })
// {"time":1758991234567,"level":"info","orderId":42}

logo.error("paid failed", err, { userId: 7 })
// {"time":...,"level":"error","msg":"paid failed","message":"...","stack":"...","userId":7}
```

`msg` 为空字符串时不输出该键。

**这是与 Go 版 logo 的有意偏离**：Go 的 `Info` 会在格式串里自动补 `%v`、`JsonI` 收交替的 key-value。JS 没有 printf 传统，一个对象就是一份数据，所以只有一套方法。

`time`、`level`、`msg` 是保留字段，用户数据与之同名时保留信封值。`name` 只能通过 `logo.child({ name })` 设置——那是 logger 的名字，不是业务数据。

`warn` 与 `error` 默认附带 `stack`（调用点栈帧，已剪掉 logger 内部帧）；`info`/`debug` 不采集，因为采集栈比拼字符串慢两个数量级。由 `stackLevel` 控制，默认 `"warn"`，可设成 `"error"` 或 `"off"`。

### 6.3 落盘格式

一行一条，前缀给人看、后面给机器解析：

```
2026-10-22T15:04:05 [I] {"msg":"burst","seq":1,"total":2}
```

- 时间是**东八区、精确到秒**，固定时区不跟机器走（§6.6）。
- 级别是 `[D]/[I]/[W]/[E]`，与 Go 版 logo 一致。
- `time` 与 `level` 只出现在前缀，JSON 里不再重复——同一条信息写两遍既浪费，也会出现两个可能不一致的来源。
- JSON 部分由 `safeStringify` 产出，循环引用等异常值不会让整行写不出来。
- `parseLine` 负责把载荷解析回来；前缀不参与解析。

### 6.4 记录结构

```ts
interface LogRecord {
  time: number            // epoch 毫秒，UTC 存储，展示时按浏览器本地时区
  level: "debug" | "info" | "warn" | "error"
  name?: string           // child 的标识，默认不出现
  msg?: string
  stack?: string          // 仅 warn/error（由 stackLevel 控制）
  [field: string]: unknown
}
```

### 6.5 Sink 与批量刷新

```ts
type Sink = (batch: readonly LogRecord[]) => void
```

一次调用拿到**一批**记录，不是一条一条喂。目的很具体：一个循环里连写 1000 条日志，IO 只发生 1 次而不是 1000 次，不会把进程卡死。

刷新策略：

- 记录先进缓冲区，不立即写。
- 定时刷新，默认 100ms 一次（`flushIntervalMs`）。
- **`warn`/`error` 立即刷新**：先把缓冲区里积压的全部写掉（不受 `maxBuffer` 与时间窗限制，一条不丢，因为 `error` 之后进程可能就没了），再同步写出当前这条，两次 IO 而不是等到下一个周期。排错时不能等 100ms，而且崩溃前那几条最关键。
- 缓冲区上限默认 10000 条，**达到上限立即 flush**（不丢记录）——用它兜住内存，而不是牺牲日志。
- 手动 `logo.flush()`；进程退出前调 `logo.dispose()`，否则缓冲区里最后一批会丢。
- 定时批量只在“能同步写 stdout”的环境里启用（探测方式同 §7）。Workers 上每条立即写出：那边的输出本身就是平台级缓冲，而且响应结束后未触发的定时器可能被取消，批量反而会把日志弄丢。

sink 是同步函数。抛错被捕获并忽略（一条坏 sink 不能拖垮业务），第一次出错时用 `console.error` 打一行提示（Workers 没有 stderr）。需要网络或限流的 sink（飞书）在自己的 batch 回调里处理，logger 不管背压。

### 6.7 基础集合：SortedTable

移植 unicorn 的 `SortedTable<TKey, TValue>`（C#）：两个并行数组维护“key 始终有序”的键值表，查找二分，按下标访问 O(1)，插入/删除移动数组 O(n)。

- `add` 重复 key 抛错（C# 的 Add 语义），`set` 插入或覆盖（索引器 setter 语义）。
- `append` + `sort` 用于批量构建：逐个 `add` 每次都要移动数组，追加是 O(1)，最后统一排序。
- `snapshotKeys` / `snapshotValues` 返回副本，遍历不受后续增删影响。
- 自定义 `comparer` 可倒序。

用途是“读多写少、需要顺序遍历、需要按下标取整列”的数据；高频随机插入用 `Map`。

### 6.6 时区

存储是 epoch 毫秒（不带时区），展示固定 `+08:00`。`formatTime()` 负责这件事。不跟机器时区走的理由：开发机在 UTC、服务器在 Shanghai 时，同一条日志两边显示的时间不一样，排障先要算时差。

## 7. 内置 sink

**stdout**（默认）：能拿到 `process.stdout.write` 就一次性把一个 batch 拼成多行写进 stdout，否则逐条 `console.log`。检测是同步能力探测（`typeof process?.stdout?.write`），不 import 任何东西，所以也是 §6.4 判定要不要启定时批量的依据。

**文件**（`./node`）：按级别分文件，且高级别级联写入低级别文件：

| 文件 | 内容 |
|---|---|
| `info.log` | info + warn + error |
| `warn.log` | warn + error |
| `error.log` | error |

这样查一个问题不用同时翻三个文件：先扫 `info.log` 看全局，只想看告警就看 `warn.log`。打开 debug 级别时传 `minLevel: "debug"` 才会多一个 `debug.log`；没写过就不建空文件。

按大小滚动，单文件默认 10MB，归档名形如 `info-2026-10-22T12-00-00-000Z.log`，保留 7 天。用 `appendFileSync` 一次写一个 batch——反正已经是每 100ms 一次，阻塞时间可以接受，换来的是「warn/error 立即落盘」和「退出前 flush 就真的写下去了」。

**飞书**（`./lark`）：把 batch 推到群机器人 webhook。默认只推 `error` 级别，超出窗口的记录合并成一条消息，令牌桶限流（默认 20 条/分钟），支持可选签名密钥。用 `fetch`，Workers 可用。

## 8. 控制台

### 8.1 挂载

`createConsole()` 返回一个 `(Request) => Response` 的 handler 和一个 `dispose()`。

```ts
const debug = createConsole({
  logger: logo,
  auth: { users: { admin: "secret" }, secret: process.env.DBG_SECRET! },
  commands: [myCommand],
  topics: [myTopic],
  basePath: "/console",
  title: "my-service",      // 头栏与浏览器标签页显示的项目名，默认 "console"
})

// Hono
app.all("/console/*", (c) => debug.handler(c.req.raw))
// 裸 Node
http.createServer(toNodeHandler(debug.handler)).listen(7701)
// Bun（本地开发）
Bun.serve({ port: 7701, fetch: debug.handler })
```

控制台内部自己建两个 sink：一个环形缓冲（历史，供 `log.list` 命令）和一个广播器（实时，供 SSE），两者都由 `logger.addSink` 挂上，`dispose()` 时摘掉。因此日志视图在实现上仍然只是一个 sink，但装配细节不丢给调用方。不引入全局单例，依赖从参数进来，装配关系在调用处一眼看全。

`basePath` 可选，默认空字符串。挂在子路径上时必须给（Hono 的 `app.all("/console/*")` 里 `c.req.raw.url` 仍带前缀），router 按它剥前缀，页面里的 JS 也用它拼 `/events` 和 `/exec` 的地址。

### 8.2 路由

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/` | 页面（单个 HTML，内联 JS/CSS） |
| GET | `/events?topics=top:5000` | SSE 流：日志、主题推送。需鉴权 |
| POST | `/exec` | 执行一条命令，同步返回结果 |
| GET | `/health` | `{"ok":true}` |
| GET | `/log/<name>` | 日志文件全文，需 `Authorization: Bearer` |

命令结果走 POST 的响应体，不走 SSE。理由：请求/响应本身是天然的一问一答，同步返回比"发出去再等推送"少一套 id 对账和超时清理。SSE 只负责服务端主动推的东西。

`/exec` 的请求与响应：

```
POST /exec   { "line": "log.list" }
             + Authorization: Bearer <token>

200  { "ok": true,  "output": CommandOutput }
200  { "ok": false, "error": "unknown command: foo" }
401  { "ok": false, "error": "unauthorized" }
```

命令执行失败是业务结果，用 200 承载；401 只留给鉴权失败，前端据此提示重新登录。`dispose()` 之后所有路由返回 503。

四条工程约束，写在这里避免实现时各写各的：

- `/exec` 请求体上限 4KB，超过直接 413。命令是手敲的，不应该有 MB 级请求。
- 单条命令默认超时 10 秒，超时返回 `{ok:false, error:"timeout"}`，防止一个卡住的命令占死连接。
- SSE 空闲时才发注释心跳（`: ping`，默认 15 秒一次，期间有数据就不发）。反向代理按"无数据"计超时（nginx 默认 60 秒），这一行是给中间层看的，控制台里不显示。
- 页面和接口必须同源（都在 `basePath` 下）。不做 CORS，因为控制台本来就不应该跨域暴露。
- 日志文件链接不带凭证：点击时用 `Authorization` 头取回全文，再用 blob URL 在新窗口打开。把 token 放进 URL 会进地址栏、历史记录和访问日志，而且一旦签发就有时效——用户过一会儿再点就是 401。

### 8.3 SSE 协议

每条消息一个 `event` + 一行 JSON `data`：

```
event: handshake
data: {"title":"Needle","version":"0.1.0","user":"admin","commands":[...],"topics":[...]}

event: log
data: {"time":...,"level":"info","msg":"..."}

event: topic
data: {"name":"top","data":{...}}
```

**`/events` 必须带合法 token，否则 401。** 日志流是这套东西里最敏感的数据，匿名只应该能拿到页面和 `help`。页面加载时若没有 token 或 token 已失效，显示"先 auth"，不反复重试；`auth` 成功后再建立连接。

`handshake` 在连接建立后立即发送，前端用它拿项目名、命令表、主题表和当前身份。名字照 gonsole `road` 层的握手语义：连接建立后服务端先发一帧配置，客户端据此决定怎么渲染和补全。`topics` 用查询参数声明，断线重连时自动重新订阅（`fetch`+`ReadableStream` 读流，不用原生 `EventSource`，因为要带 `Authorization` 头）。

### 8.4 命令

```ts
type CommandOutput =
  | { kind: "text";  text: string }
  | { kind: "table"; columns: string[]; rows: Array<Array<string | number | null>> }
  | { kind: "json";  value: unknown }

interface Command {
  name: string
  note: string
  args?: string                       // 帮助里显示的参数说明
  public?: boolean                    // 匿名可执行，默认 false
  run(ctx: CommandContext): Promise<CommandOutput> | CommandOutput
}

interface CommandContext {
  args: string[]                      // 已按空格切分（不做引号解析）
  user: string | null
  log: Logger
}
```

失败用抛错表示（`throw new CommandError("unknown command: foo")`），router 统一捕获并转成 `{ok:false, error}`。这样 `run` 正常路径只返回输出，不用每层判断 `ok`。

内置：`help`、`log.list`、`top`、`auth <user>`、`sub`、`unsub`。`help`/`auth`/`sub`/`unsub` 是 public，其余默认需要登录。不提供 `logout`：登录态是可过期的 token，过期即回到未登录，不需要主动退出。

名字重复时，调用方传入的命令优先于内置命令——内置只是默认值，不是特权层。

输出形态固定三种：`help` 用 `text`，`log.list`/`top` 用 `table`（浏览器里渲染成真表格），需要嵌套结构时用 `json`。前端只需处理这三种，不做字符串解析。

表格的两条约定：

- **数字传原始值，不预格式化**。`table.rows` 允许 `number`，展示层负责转成人话，排序也按原始数值而不是字符串。
- **列语义用 `formats` 声明**，不是靠猜。`auto`（缺省）：整数且 ≥1024 用 `toHuman`；`bytes`：字节，永远走 `toHuman`；`duration`：毫秒，走 `formatDuration`（`57720` → `57.7s`）；`number`：计数原样。
  这一条是修 bug 修出来的：曾经把 `uptimeMs` 当普通整数套 `toHuman`，显示成 `57.72K`——毫秒不是字节，单位错了就是错。
- **表头可点击排序**，再点一次反向（照 gonsole `JsonTable` 的交互）。

### 8.5 主题（周期性推送）

```ts
interface Topic {
  name: string
  note: string
  intervalMs: number
  read(): Record<string, unknown>
}
```

内置 `top`（1000ms）与 `mem`（5000ms）。它们由 `createConsole` 默认创建（数据源就是 §9 的指标对象），调用方传的 `topics` 追加在后面，同名时调用方优先。

间隔的两处来源有明确优先级：`Topic.intervalMs` 是默认值；客户端可以用 `?topics=top:5000` 覆盖，覆盖值钳到 `[1000, 60000]`；只写 `topics=top` 表示用默认值。钳位在服务端做，前端传什么都打不死进程。

每个 SSE 连接持有自己的定时器，连接关闭即清理——不做跨连接的共享 ticker，省掉一套引用计数。

### 8.6 三种宿主

同一份 `source` 上面挂不同的适配器：

| 场景 | 入口 | 传输 |
|---|---|---|
| Node / Bun 服务 | `createConsole(options).handler` | HTTP + SSE |
| Cloudflare Workers | 同上，直接挂到 `export default { fetch }` | HTTP + SSE |
| 浏览器页面 / Chrome 扩展 | `createBrowserConsole({ element, ... })` | 进程内直调 |

浏览器模式传 `user`，source 跳过 token 鉴权——能看到面板的人本来就能碰到这个进程。

## 9. 指标

`top`（命令）与 `top`/`mem`（主题）读同一个内部指标对象，Node 与 Workers 各给一份实现。检测在首次 `read()` 时做一次并缓存。

探测只看能力，**不做任何 import**：`import(变量)` 在 workerd 里是非法的（要求静态模块说明符，运行到就抛 `ERR_MODULE_DYNAMIC_SPEC`）。这条是 miniflare 集成测试跑出来的，不是推测。判定条件就是 `typeof process?.memoryUsage === "function"`：边缘运行时要么没有 `process`，要么只有残缺替身。


- Node：`process.memoryUsage()` 的 `rss`/`heapUsed`、事件循环利用率（`globalThis.performance.eventLoopUtilization`，没有就跳过）、运行时长、SSE 连接数。
- Workers：没有 `process.memoryUsage` 这类读数（Workers 的 `process` 是部分实现，未实现的方法直接抛错）。只能给自维护计数器：启动时间、SSE 连接数。

返回字段固定为 `runtime`（`"node"` | `"workers"`）与 `uptimeMs`；Node 额外有 `rss`、`heapUsed`、`loopDelayMs`。Workers 分支不返回这几个键，前端按存在与否渲染。

运行时检测不用 `typeof window`，用能力检测：能动态 import 到 `node:perf_hooks` 就是 Node，否则走 Workers 分支。

## 10. Workers 降级清单

| 能力 | Node | Workers |
|---|---|---|
| `logo.*` 日志 | 完整 | 完整 |
| stdout sink | 完整 | 退化为 `console.log` |
| 文件 sink | 有 | 无（`node:fs` 不存在） |
| 飞书 sink | 有 | 有（`fetch`） |
| 控制台页面 / SSE | 有 | 有 |
| 命令执行 | 完整 | 完整（只是看到的是本 isolate） |
| 日志视图 | 全进程 | **仅本 isolate** |
| CPU / 内存指标 | 真实读数 | 自维护计数器 |
| 历史日志 | 进程内环形缓冲 | 同左，isolate 重建即丢失 |
| 登录态 | 重启失效 | 每次 isolate 回收失效（必须配固定 secret，见 §12） |

关键限制写在部署文档里：Workers 上控制台那条 SSE 连接活在某个 isolate 里，别的 isolate 产生的日志看不到。要跨 isolate 必须引入 Durable Object 或外部汇聚，那是另一个决定，不在本期范围。

## 11. 前端

单个 HTML 字符串（模板字面量），内联 CSS 与 JS，不引入框架、不走 CDN、不构建。

主题推送落成输出区的一行（`[top] rss=36.3MB heap=1.6MB`），不做常驻面板：常驻面板会一直占着版面，而人看指标是"瞟一眼"，不是"盯着"。想持续看就 `sub top 2000`，输出区跟着滚。

界面三块：上方输出区（日志与命令结果混排，按类型着色）、中间主题面板（`top` 的表格）、底部输入框（回车发送，上下键翻历史，历史存 localStorage）。

配色用 Solarized Dark（Ethan Schoonover 那套），不自己调色：

| 用途 | 色值 |
|---|---|
| 页面背景 | `#002b36` (base03) |
| 强调块/输入区 | `#073642` (base02) |
| 次要文字、debug | `#586e75` (base01) |
| 正文 | `#839496` (base0) |
| 强调正文 | `#93a1a1` (base1) |
| info | `#2aa198` (cyan) |
| warn | `#b58900` (yellow) |
| error | `#dc322f` (red) |
| 命令回显/link | `#268bd2` (blue) |

等宽字体栈 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`，不下载字体。

前端 JS 同样按教材标准写：`renderLog` / `runCommand` / `connect` 各管一件事。

**Tab 补全**：只按行尾补全，候选来自 handshake 的命令表（所以服务器上自定义的命令一样能补），加上 `auth`/`sub`/`unsub` 这几个客户端命令；`sub`/`unsub` 的第二个词补主题名。唯一候选直接补全，多个候选先补公共前缀，再按一次列出候选。Tab 永远 `preventDefault`，不会把焦点移走。

**头栏**：项目名（`title`，默认 `console`）+ 版本 + 当前用户，全部靠左。项目名同时用作浏览器标签页标题。

## 12. 鉴权

`auth <user>` 命令（回车后输入框切成 `type=password`，密码走 `POST /auth`，不进历史），服务端校验后签发 token：

```
payload = base64url({"sub":"admin","exp":1758994834567})
token   = payload + "." + base64url(HMAC-SHA256(secret, payload))
```

- 配置形如 `auth: { users: { admin: "secret" }, secret: "..." }`。core 不读环境变量（Workers 上没有 `process.env` 的常规语义），secret 必须由宿主传进来。
- 没传 secret 就随机生成，重启后所有 token 失效，启动时打一行警告。Workers 上必须传固定 secret，否则每次 isolate 回收都会让已登录的浏览器掉线。
- 密码直接以字符串保存在内存里，比较时逐字节等时比较（内存里存摘要不增加任何安全性）。
- 前端存 localStorage，请求时放 `Authorization: Bearer <token>`。token 带 `exp`，默认 12 小时（`auth.ttlMs` 可调）；过期后前端回到未登录态，重新 `auth` 即可。
- 未登录：`public` 命令可跑，其余返回 401，前端提示"先 auth"。
- 不做 Basic auth：浏览器原生弹窗是一刀切的，而且凭据会被自动带给同源的其他接口。

## 13. 包与构建

包名 `@needle/logo`。

```
package.json exports:
  "."           → dist/core/index.js
  "./console"   → dist/console/index.js
  "./node"      → dist/node/index.js
  "./lark"      → dist/lark/index.js   // 飞书 sink 单独入口，不拖累 console 的体积
```

`"type": "module"`、`"sideEffects": false`。入口靠 subpath 显式区分，不用条件导出——文件 sink 已经在 `./node` 里，核心入口不存在需要按运行时分支的模块。`./node` 内部对 `node:fs` 一律动态 `import()`。

构建：`tsc`（TypeScript 7.0.2 原生版已验证能产出 `.js` + `.d.ts`）。不做额外打包，`bun build` 只在测体积时用。

`dist/` 随源码一起提交，否则 Git 依赖（`git+https://…`）拿到的是没有产物的源码。`.githooks/pre-commit` 在每次提交时重跑 `bun run build` 并把 `dist/`、`src/console/ui/script.generated.ts` stage 进同一个 commit——产物和源码永远同版本，不依赖 CI。

体积实测：入口 `.` 1.7KB（min+gzip），`./console` 9.2KB（含内联页面脚本）。

## 14. 目录

```
src/
  core/
    logo/
      logo.ts       # newLogger + 默认实例
      record.ts     # 记录构造与 JSON 安全化
      line.ts       # 落盘行格式 + 东八区时间
      human.ts      # 人读数字/时长
      types.ts      # Level / LogRecord / Sink
      index.ts      # 汇总 + 默认 logo 实例
      sinks/
        stdout.ts   # stdout sink + 能力探测
        file.ts     # 文件 sink（依赖 node:fs，只从 ./node 导出）
        lark.ts     # 飞书 sink（独立入口 ./lark）
    collections/    # 与业务无关的通用数据结构
      sorted-table.ts
    logger.ts       # logo 门面
    record.ts       # 记录构造与参数归一化
    sink.ts         # Sink 类型、stdout sink
    ring.ts         # 环形缓冲（带 read 的 sink）
    types.ts        # 共享类型（level、LogRecord）
  console/
    index.ts        # createConsole：装配
    router.ts       # 路由分发（一个 switch）
    sse.ts          # SSE 编码与连接生命周期
    commands.ts     # 参数切分与命令查找
    builtins.ts     # 内置命令
    exec.ts         # POST /exec：鉴权、限额、超时
    types.ts        # 命令与输出类型
    auth.ts         # token 签发/校验
    metrics.ts      # 指标读取（能力检测）
    page.ts         # 单文件 HTML
  lark/
    index.ts        # 飞书 sink（批量 + 限流 + 签名）
  node/
    index.ts
    file-sink.ts    # 滚动文件
    serve.ts        # (Request)=>Response 挂到 node:http
test/
  unit/...
  integration/...
docs/deploy/workers.md
```

## 15. 代码风格契约

代码是给人读的教材，不是给编译器看的。

- 纯函数优先。类只在需要持有生命周期时用（SSE 连接、文件 sink、限流器）。
- 依赖从参数进来，不在函数体里 `import` 具体实现。`createConsole({ records, auth, commands })` 就是装配点。
- 每个文件一件事，超过 150 行就拆。函数超过 50 行就拆（AGENTS.md §12）。
- 命名用完整单词，不用缩写。`createRingSink` 不叫 `mkRing`。
- 注释写"为什么"，不写"做什么"。凡是看似可以更简单的写法，注释解释为什么没采用。
- 不用 `any`。外部输入用 `unknown` + 校验函数收窄。
- 错误是值不是控制流：面向调用方的可预期失败（命令执行出错、鉴权失败）用 `{ ok: false, error }` 表达；命令实现内部可以直接 `throw CommandError`，由 router 统一转成该形状。只有这一处转接，不让 ok 判断钻进每个命令。
- 不写投机性的抽象。只有一个实现的接口不抽（AGENTS.md §2），除非第二个实现已经存在（如 Node/Workers 指标）。

## 16. 测试

- 单元：参数归一化（字符串/对象/Error/循环引用）、字段冲突、批量刷新（连写 N 条只触发 1 次 sink、warn/error 立即触发、缓冲上限丢最旧并计数）、调用栈采集开关、环形缓冲、token 签发与过期、命令解析、路由分发、限流器。
- 集成：起一个 `node:http` 服务挂上 handler，用 `fetch` 走完整流程——登录、跑公开命令、跑受限命令、收 SSE 日志、收主题推送。
- 无运行时依赖验证：单元与集成测试都在 Bun 下跑（Bun 能解析 `.js` 后缀到 `.ts`，已实测）；Node 侧由 `test/smoke/node.mjs` 跑构建产物做冒烟断言。
- Workers 兼容性必须实测：用 miniflare 起 workerd 环境，跑一遍登录、公开命令、受限命令、SSE 日志流、主题推送，断言 fs/process 相关能力不存在时也能正常工作。这一项是 §2 目标 4 的唯一成立依据。
- 覆盖率目标 ≥ 80%（AGENTS.md §11）。

## 17. 待定

1. Workers 上要不要提供 Durable Object 版本的共享日志缓冲。默认不做，文档里留说明。
