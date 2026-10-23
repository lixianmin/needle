# logo

线上排障用的控制台和日志库：在浏览器里看实时日志、敲命令查进程状态、订阅指标，不用 `docker exec` 进去 `tail -f`。

零运行时依赖：日志库 2.7 KB，含控制台 13.7 KB（min+gzip，`bun run size` 可复现）。

## 一、控制台

目的是**不登机器也能知道进程此刻在干什么**：日志在滚什么、某个业务状态是什么、指标有没有异常。线上出事时打开浏览器就有答案，不用改代码重发，也不用 `ssh` 进去翻文件。

形态是一个网页 shell：中间一个滚动区，日志和命令输出都往这里追加；底部一个输入框，回车执行。

### 先登录

控制台默认要 token，登录是使用前提（只绑本机时可以用 `user` 跳过，见「四、安装与使用」）。没登录时只有 `help`、`auth`、`sub`、`unsub` 能跑，其余命令和日志流都是 401：

```
$ auth ops
密码:            # 输密码时不回显、不进历史
```

口令走独立的 `POST /auth`，所以密码不会出现在命令行、浏览器历史或服务端日志里。登录态是 HMAC-SHA256 签名的 token，默认 12 小时过期，过期后重新 `auth` 即可，没有 `logout`。

要让登录态在重启后仍然有效，或者多个进程共享，必须显式给 `secret`（见「四、安装与使用」）；不给就每次启动随机生成。

### 能敲哪些命令

`help` 列出全部命令——包括你自己注册的，Tab 补全的候选也来自同一张表。内置的几条：

| 命令 | 干什么 |
|---|---|
| `help` | 列出所有命令 |
| `auth` | 登录（唯一入口） |
| `log.list` | 列出磁盘上的日志文件，点文件名用 header 鉴权取回全文 |
| `top` | 打一份进程指标快照 |
| `sub` / `unsub` | 订阅 / 取消订阅主题，如 `sub top 2000` |

登录之后，进程新写的日志由 SSE 推过来，自己往下滚，不用轮询。`sub top 2000` 则是订阅类的：之后每 2 秒往滚动区落一行

```
[top] runtime=node  uptimeMs=57.7s  connections=1  rss=34.61M  heapUsed=12.3M …
```

`unsub top` 停掉，`unsub` 停掉全部。

`log.list` 需要服务端配了 `logFiles`；不配的话命令还在，但执行会直接报错说明没配日志目录。

### 你自己的命令

命令就是一个注册进去的函数，返回值决定渲染方式：

| 返回 | 渲染成 |
|---|---|
| `{ kind: "text", text }` | 一段纯文本 |
| `{ kind: "table", columns, rows }` | 表格，点表头按原始数值排序 |
| `{ kind: "json", value }` | 格式化 JSON |

表格列可以声明语义：`bytes` 走 `toHuman`（`36290560` → `34.61M`），`duration` 走 `formatDuration`（`57720` → `57.7s`），`number` 不缩写。

命令在进程内执行，所以能直接读内存里的状态——订单表、连接池、队列长度，不用先为它打一条日志。默认超时 10 秒，超了返回 `timeout`，不会把请求挂住。

## 二、日志模块

### 为什么要有它

`console.log` 只是把一行字符串丢给 stdout，线上排障时会缺三样东西：

- **级别**：没法让 `debug` 平时闭嘴、`error` 立即出去。
- **字段**：正文只是字符串，想按 `orderId` 过滤得自己解析。
- **去处**：stdout 走了就没了；想按级别分文件、想把 error 推到飞书，得自己接。

所以在日志进 stdout 之前加一层：一次调用变成一条结构化记录，再由你挂的 sink 决定它去哪。

```ts
import { logo } from "@needle/logo";

logo.info("order created", { orderId: 42 });
// 打印：2026-10-23T10:50:43 [I] {"orderId":42,"msg":"order created"}
// sink 收到：{"orderId":42,"time":1758991234567,"level":"info","msg":"order created"}

logo.error("paid failed", err, { userId: 7 });
// Error 展开成 message + stack
```

### 它是怎么走的

一条调用经过三步：

1. **组记录**：字符串拼成 `msg`，对象合并进字段，`Error` 展开成 `message` + `stack`。
2. **按级别决定节奏**：`warn` / `error` 立即写出并带调用栈；`info` 攒批 100ms，一个循环写 1000 条只产生一次 IO。默认级别是 `info`，`debug` 要 `setLevel("debug")` 才出来。
3. **分发给所有 sink**：同一批记录给每一个挂上去的 sink，各自决定收哪些、写到哪。`logo` 默认挂了一个写 stdout 的。

```ts
import { createFileSink } from "@needle/logo/node";
import { createLarkSink } from "@needle/logo/lark";

logo.addSink(createFileSink({ dir: "logs" }));                                       // 按级别分文件
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!, minLevel: "error" })); // error 推飞书
process.on("SIGTERM", () => logo.dispose());                                         // 退出前冲缓冲区
```

要另起一个实例（换级别、换名字）用 `newLogger()`；`newLogger({ sinks: [...] })` 可以在创建时就把 sink 配好。

三个设计取舍：

- **SSE 而不是 WebSocket**：WebSocket 在 Node 要 `ws`、Bun 要传 `websocket`、Workers 必须上 Durable Object；SSE 只要一个 `(Request) => Response`。
- **批量写而不是逐条**：1000 条日志 = 1 次 IO，`warn` / `error` 例外。
- **控制台与日志内核拆开**：同一套命令走 HTTP/SSE 或直接挂 DOM，不会有两份实现。

设计文档见 `docs/superpowers/specs/2026-10-22-logo-design.md`。

## 三、平台支持

同一个库，能拿到什么取决于跑在哪：

| 平台 | 控制台形态 | 文件 sink | 日志视图 | 细节 |
|---|---|---|---|---|
| 服务端 Node / Bun | HTTP + SSE | 有 | 全进程 | [server.md](docs/best-practices/server.md) |
| Cloudflare Workers | HTTP + SSE | 无 | 仅当前 isolate | [server.md](docs/best-practices/server.md) |
| Chrome 扩展（MV3） | DOM 面板 | 无 | 当前页面 | [chrome-extension.md](docs/best-practices/chrome-extension.md) |
| 浏览器纯前端页 | DOM 面板 | 无 | 当前页面 | [browser-client.md](docs/best-practices/browser-client.md) |

文件 sink 只在有 `node:fs` 的地方能用：`@needle/logo/node` 顶层 `import "node:fs"`，浏览器和 Workers 打包时不能碰它；core 的 `.` 入口是干净的。

三篇文档按平台各自写全（接线、鉴权、日志落点、坑），跨篇重复是故意的——你只需要读自己那篇。

## 四、安装与使用

### 装

```bash
# 还没发到 npm，从仓库装。dist 随源码提交，所以不需要构建步骤。
bun add git+https://github.com/lixianmin/needle.git
```

### 接日志

业务代码里直接 `logo.info(...)`，退出前 `logo.dispose()`。挂 sink、改级别、换名字、`newLogger()` 都在「二、日志模块」。

### 挂控制台

控制台对外只有一个接口 `(req: Request) => Promise<Response>`，挂载就是把它接到你的服务器上。Hono 是两条路由：

```ts
import { logo } from "@needle/logo";
import { createConsole } from "@needle/logo/console";
import { createLogFiles } from "@needle/logo/node";

const debug = createConsole({
  logger: logo,
  basePath: "/console",     // 必须与下面路由前缀一致：handler 内部按它剥前缀
  title: "order-service",
  auth: { users: { ops: process.env.CONSOLE_PASSWORD! }, secret: process.env.CONSOLE_SECRET! },
  logFiles: createLogFiles({ dir: "logs" }),   // 不给的话 log.list 用不了
});

// 先注册控制台，再注册业务中间件：app.use 只作用于它之后注册的路由。
app.all("/console", (c) => debug.handler(c.req.raw));
app.all("/console/*", (c) => debug.handler(c.req.raw));
```

两条路由缺一不可：`/console` 是页面，`/console/*` 是 `/events`、`/exec`、`/log/:name`。只挂一条的话页面能打开，登录和命令全是 404。

`auth.users` 非空即服务端模式；`user: "local"` 是「能看到页面的人本来就能碰这个进程」时才用的本机开关，绑 `0.0.0.0` 或公网时不能用。其它框架（Express / Fastify / 裸 `node:http`）用 `@needle/logo/node` 的 `attach(server, debug, { basePath: "/console" })`；平台细节见「三、平台支持」指向的三篇。

### 跑一遍

```bash
bun examples/demo.ts    # http://127.0.0.1:1234/console，账号 xmli / 123456
```

`room` 读业务状态、`io` 看表格排序、`burst 200` 看批量推送、`boom` 验证 error 带栈、`slow` 验证 10 秒超时。

### 会踩的坑

- **正文在 `msg`，不是 `message`。** 只有传 `Error` 才会出现 `message`（+`stack`）。
- **`time` / `level` 不在打印出的 JSON 里。** 落盘行是 `2026-10-23T10:50:43 [I] {…}`：时间与级别只在前缀，记录的 `time` 是 epoch 毫秒。时间固定东八区，与机器 `TZ` 无关；`parseLine()` 也只还原 JSON 那段。
- **`info` 不会立刻到 sink。** 测试与脚本里断言前先 `flush()`；`warn` / `error` 立即写，并把积压一起带出去。
- **只有 `warn` / `error` 默认带 `stack`。** `stackLevel` 默认 `warn`，要 info 也带用 `"info"`，关掉用 `"off"`。传 `Error` 时用的是它自己的栈（抛出点）。
- **`dispose()` 之后日志静默丢弃。** 退出前调一次，别在长生命周期进程里早调。
- **库自己的字段不让业务改。** `level` / `time` / `msg` / `name` / `stack` 由库填：`info("x", { level: "error", msg: "fake" })` 仍记成 `level:"info", msg:"x"`。
- **普通对象以外的值会整个进 `msg`。** 数组、`Date`、`Map`、类实例都序列化后拼进 `msg`，不会变成可查询的字段；要按字段过滤就传普通对象。
- **从 git 装的是固定 commit。** lockfile 钉住 sha，`bun install` 不会把它推到最新；升级要重新 `bun add` 那个地址（或换成新的 sha）。两个依赖分别解析到不同 sha 时会有两份副本，`logo` 变成两个对象，各自的 sink 互不可见。

## 开发

`dist/` 随源码一起提交，这样 git 依赖不需要构建步骤就能用。克隆后执行一次 `git config core.hooksPath .githooks`，之后每次提交都会自动重建 `dist/` 并 stage 进同一个 commit。
