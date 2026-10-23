# logo

线上排障用的控制台日志库：把 `docker exec` + `tail -f` 换成浏览器里的一个页面。

零运行时依赖。只做日志 2.7 KB，带控制台 13.7 KB（min+gzip，`bun run size` 可复现）。

```ts
import { logo } from "@needle/logo";

logo.info("order created", { orderId: 42 });
// 打印：2026-10-23T10:50:43 [I] {"orderId":42,"msg":"order created"}
// sink 收到：{"orderId":42,"time":1758991234567,"level":"info","msg":"order created"}

logo.error("paid failed", err, { userId: 7 });
// Error 展开成 message + stack
```

它有两半，共用同一个 logger。

**日志**：级别、字段、`Error` 展开、100ms 攒批、sink 可插拔（stdout / 文件 / 飞书），用法在下面「写日志」。

**控制台**：浏览器里打开 `/console`。登录后进程的实时日志由 SSE 推进来，自己往下滚，不用轮询。常用的三件事：

| 输入 | 看到什么 |
|---|---|
| `log.list` | 磁盘上的日志文件（`info.log` / `warn.log` / `error.log`），点文件名看全文（需要配 `logFiles`） |
| `order 42` | 你在 `commands` 里注册的命令，返回什么渲染什么——读的是进程里的 Map、连接池、队列，不用先打日志 |
| `sub top 2000` | 之后每 2 秒落一行 `[top] runtime=node  uptimeMs=57.7s  connections=1  rss=34.61M  heapUsed=12.3M …`，`unsub top` 停 |

## 安装

```bash
# 还没发到 npm，从仓库装。dist 随源码提交，所以不需要构建步骤。
bun add git+https://github.com/lixianmin/needle.git
```

## 写日志

字符串拼成 `msg`，对象合并进字段，`Error` 展开成 `message` + `stack`。`child()` 给一组记录钉住公共字段：

```ts
const db = logo.child({ name: "db", traceId: "t1" });
db.warn("slow query", { ms: 1200 });
```

`warn` / `error` 立即写出并带调用栈；`info` 攒批 100ms，一个循环写 1000 条只产生一次 IO。`logo` 是写 stdout 的默认实例，换级别、名字、sink 用 `newLogger()`。

sink 事后挂，不必在构造时定死：

```ts
import { createFileSink } from "@needle/logo/node";
import { createLarkSink } from "@needle/logo/lark";

logo.addSink(createFileSink({ dir: "logs" }));                                       // 按级别分文件
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!, minLevel: "error" })); // 出事推飞书
process.on("SIGTERM", () => logo.dispose());                                         // 退出前冲缓冲区
```

## 挂控制台

控制台不是第二个 logger：它挂在同一个 `logo` 上，一块 sink 收实时日志、一张命令表读进程状态。对外只有一个接口 `(req: Request) => Promise<Response>`。

### 挂载（Hono）

```ts
import { createConsole } from "@needle/logo/console";
import { createLogFiles } from "@needle/logo/node";

const debug = createConsole({
  logger: logo,
  basePath: "/console",     // 必须与下面路由前缀一致：handler 内部按它剥前缀
  title: "order-service",
  auth: { users: { ops: process.env.CONSOLE_PASSWORD! }, secret: process.env.CONSOLE_SECRET! },
  logFiles: createLogFiles({ dir: "logs" }),   // 不传的话 log.list 直接报错说明没配日志目录
});

// 先注册控制台，再注册业务中间件：app.use 只作用于它之后注册的路由。
app.all("/console", (c) => debug.handler(c.req.raw));
app.all("/console/*", (c) => debug.handler(c.req.raw));
```

两条路由缺一不可：`/console` 是页面，`/console/*` 是 `/events`、`/exec`、`/log/:name`。只挂一条的话页面能打开，登录和命令全是 404。

### 登录

`auth` 是唯一登录入口。没登录时只有 `help`、`auth`、`sub`、`unsub` 可跑，其余命令和日志流都要 token：

```
$ auth ops
密码:            # 不回显、不进历史
```

口令走独立的 `POST /auth`，所以密码永远不会出现在命令行里。`users` 非空即服务端模式，非 public 命令与 `/events` 都要 token；`user: "local"` 是「能看到页面的人本来就能碰这个进程」时才用的本机开关。`secret` 不传就随机生成，重启后已签发的 token 全失效。

### 命令

命令返回 `text` / `table` / `json` 三种形态，前端照着渲染。表格列可声明语义：`bytes` 走 `toHuman`（`36290560` → `34.61M`），`duration` 走 `formatDuration`（`57720` → `57.7s`），点表头按原始数值排序。

## 按环境查阅

| 你要开发 | 读这篇 |
|---|---|
| Hono 服务端（Node / Bun / Workers） | [docs/best-practices/hono-server.md](docs/best-practices/hono-server.md) |
| Chrome 扩展（MV3） | [docs/best-practices/chrome-extension.md](docs/best-practices/chrome-extension.md) |
| 浏览器纯前端页 | [docs/best-practices/browser-client.md](docs/best-practices/browser-client.md) |

每篇自洽，跨篇重复是故意的。

## 能力边界

| 能力 | Node / Bun | Workers | 浏览器 / 扩展 |
|---|---|---|---|
| `logo.*` 日志 | 完整 | 完整 | 完整 |
| 文件 sink | 有 | 无 | 无 |
| 控制台（HTTP/SSE） | 有 | 有 | — |
| 控制台（DOM 面板） | — | — | 有 |
| 日志视图范围 | 全进程 | 仅当前 isolate | 当前页面 |

`@needle/logo/node` 顶层 `import "node:fs"`，所以它只能进 Node / Bun 产物；core 的 `.` 入口是干净的，浏览器与 Workers 打包不会碰到 `node:`。

## 常见坑

- **正文在 `msg`，不是 `message`。** 只有传 `Error` 才会出现 `message`（+`stack`）。
- **`time` / `level` 不在打印出的 JSON 里。** 落盘行是 `2026-10-23T10:50:43 [I] {…}`：时间与级别只在前缀，记录的 `time` 是 epoch 毫秒。时间固定东八区，与机器 `TZ` 无关；`parseLine()` 也只还原 JSON 那段。
- **`info` 不会立刻到 sink。** 测试与脚本里断言前先 `flush()`；`warn` / `error` 立即写，并把积压一起带出去。
- **只有 `warn` / `error` 默认带 `stack`。** `stackLevel` 默认 `warn`，要 info 也带用 `"info"`，关掉用 `"off"`。传 `Error` 时用的是它自己的栈（抛出点）。
- **`child()` 快照 sink。** 建 child 之后再给父级 `addSink`，子实例收不到；要统一落点就在启动早期建 child。
- **`dispose()` 之后日志静默丢弃。** 它先 `flush()` 再 `close()` 各 sink；退出前调一次，别在长生命周期进程里早调。
- **信封字段会被丢弃。** 业务对象不能伪造 `level` / `time` / `msg` / `name` / `stack`：`info("x", { level: "error", msg: "fake" })` 仍记成 `level:"info", msg:"x"`。
- **非纯对象进 `msg`，不进字段。** 数组、`Date`、`Map`、类实例都会序列化后拼进 `msg`；要可查询的字段就传纯对象。
- **git 依赖不会自己跟 main。** lockfile 钉住 sha 之后 `bun install` 不会动它，要显式重取（重新 `bun add` 那个 git 地址，或换到新的 sha）；两个 spec 解析到不同 sha 时 `logo` 会变成两个对象，各自 sink 互不可见。

## 本地跑一遍

```bash
bun examples/demo.ts    # http://127.0.0.1:1234/console，账号 xmli / 123456
```

`room` 读业务状态、`io` 看表格排序、`burst 200` 看批量推送、`boom` 验证 error 带栈、`slow` 验证 10 秒超时。

## 设计

- **SSE 而不是 WebSocket**：WebSocket 在 Node 要 `ws`、Bun 要 `serve()` 传 `websocket`、Workers 必须有 Durable Object；SSE 只要一个 `(Request) => Response`。
- **batch sink 而不是逐条**：1000 条日志 = 1 次 IO；`warn` / `error` 例外。
- **控制台拆 kernel + 适配器**：同一套命令走 HTTP/SSE 或直接挂 DOM，不会有两份实现。

设计文档：`docs/superpowers/specs/2026-10-22-logo-design.md`。

## 开发

`dist/` 随源码一起提交，这样 git 依赖不需要构建步骤就能用。克隆后执行一次 `git config core.hooksPath .githooks`，之后每次提交都会自动重建 `dist/` 并 stage 进同一个 commit。
