# Needle

Web Shell 控制台，支持命令查看当前系统状态，如进程状态、业务数据等。

零运行时依赖：只导入日志 1.6 KB，连 shell 15.8 KB（min+gzip，`bun run size` 可复现）。

## 一、控制台（shell）

### 1. 登录（auth）

完整的 shell 功能需要先使用`auth`命令登录：

```
$ auth username
密码:            # 输密码时不回显、不进历史
```



### 2. 命令列表（help）

`help` 列出全部命令——包括你自己注册的，Tab 补全的候选也来自同一张表。内置的几条：

| 命令 | 干什么 |
|---|---|
| `help` | 列出所有命令 |
| `auth` | 登录（唯一入口） |
| `log.list` | 列出磁盘上的日志文件，点文件名用 header 鉴权取回全文 |
| `top` | 打一份进程指标快照 |
| `sub` / `unsub` | 订阅 / 取消订阅主题，如 `sub top 2000` |

查日志用 `log.list`：它列出磁盘上的日志文件，点文件名看全文。

### 3. 自定义命令

命令写在 `createShell({ commands: [...] })` 里，`run` 拿到的上下文是 `{ args, user, log }`，返回 `text` / `table` / `json` 三种形态之一。下面是装好三个命令的完整文件：

```ts
import { logo } from "@needle/logo";
import { createShell, table, type Command } from "@needle/shell";

// 你的业务数据
const orders = new Map<string, Record<string, unknown>>();

// 1. 纯文本：一段字符串
const ping: Command = {
  name: "ping",
  note: "确认控制台还活着",
  run: () => ({ kind: "text", text: `pong ${new Date().toISOString()}` }),
};

// 2. 表格：列定义一次（顺序、表头、显示语义），行对象按字段名填
const ioTable = table<{ path: string; reads: number; bytes: number; hitRate: number }>({
  path: {},
  reads: { format: "number" },
  bytes: { format: "bytes" },
  hitRate: { format: "number" },
});

const io: Command = {
  name: "io",
  note: "按接口看流量",
  run: () =>
    ioTable.output([
      { path: "/api/user", reads: 1520, bytes: 3_600_000, hitRate: 0.982 },
      { path: "/health", reads: 12, bytes: 512, hitRate: 1 },
    ]),
};

// 3. JSON：任意可序列化的值，适合嵌套结构或要贴给别人的结果
const order: Command = {
  name: "order",
  note: "按 id 看订单",
  args: "<id>",
  run: async ({ args }) => {
    const found = orders.get(args[0]!);
    if (found === undefined) throw new Error(`没有订单 ${args[0]}`);
    return { kind: "json", value: found };
  },
};

export const shell = createShell({
  logger: logo,
  basePath: "/shell",
  auth: { users: { ops: process.env.CONSOLE_PASSWORD! }, secret: process.env.CONSOLE_SECRET! },
  commands: [ping, io, order],
});
```

细节：

- **类型**：`Command` 从 `@needle/shell` 导出，给每个命令标注类型就能拿到补全和检查。
- **`args`**：按空白切开的数组，不做引号解析，`order 42` → `["42"]`；字段 `args: "<id>"` 只影响 `help` 里的用法显示。
- **列语义**：`"bytes"` 走 `toHuman`（`36290560` → `34.61M`），`"duration"` 把数字当毫秒（`57720` → `57.7s`），`"number"` 不缩写，省略按 `auto`。点表头按原始数值排序。
- **单元格**：`string | number | null | { text, href }`，带 `href` 的渲染成链接（`log.list` 就靠这个打开日志文件）。
- **`user` / `log`**：当前登录名（本地模式是配置里的 `user`）；`log` 是控制台用的那个 logger，命令里要留痕就用它。
- **错误与超时**：抛错会作为命令失败回显；默认 10 秒超时（`timeoutMs`），超了返回 `timeout`，不会把请求挂住。
- **`public: true`**：不登录也能跑，留给 `help` 这类无副作用的命令，默认 false。
- **进程内执行**：能直接读内存状态——订单表、连接池、队列长度，不用先为它打一条日志。

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
import { createLarkSink } from "@needle/logo";
import { createFileSink } from "@needle/logo/node";

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

| 平台 | 控制台形态 | 文件 sink | 细节 |
|---|---|---|---|
| 服务端 Node / Bun | HTTP + SSE | 有 | [server.md](docs/best-practices/server.md) |
| Cloudflare Workers | HTTP + SSE | 无 | [server.md](docs/best-practices/server.md) |
| Chrome 扩展（MV3） | DOM 面板 | 无 | [chrome-extension.md](docs/best-practices/chrome-extension.md) |
| 浏览器纯前端页 | DOM 面板 | 无 | [browser-client.md](docs/best-practices/browser-client.md) |

文件 sink 只在有 `node:fs` 的地方能用：`@needle/logo/node` 顶层 `import "node:fs"`，浏览器和 Workers 打包时不能碰它；`@needle/logo` 的 `.` 入口是干净的。

三篇文档按平台各自写全（接线、鉴权、日志落点、坑），跨篇重复是故意的——你只需要读自己那篇。

## 四、安装与使用

### 装

两个包，二选一：

```bash
bun add @needle/shell   # 要 shell；它的依赖里有 @needle/logo，会一起装上
bun add @needle/logo    # 只要日志，不要 shell
```

两个包都还没发到 npm。仓库内是 bun workspace（`packages/logo`、`packages/shell`），
外部现在只能 `git clone` 后 `bun link`；发布后上面的 `bun add` 直接可用。`dist/` 随源码
提交，所以不需要构建步骤。

### 接日志

业务代码里直接 `logo.info(...)`，退出前 `logo.dispose()`。挂 sink、改级别、换名字、`newLogger()` 都在「二、日志模块」。

### 挂控制台

控制台对外只有一个接口 `(req: Request) => Promise<Response>`，挂载就是把它接到你的服务器上。Hono 是两条路由：

```ts
import { logo } from "@needle/logo";
import { createLogFiles } from "@needle/logo/node";
import { createShell } from "@needle/shell";

const shell = createShell({
  logger: logo,
  basePath: "/shell",     // 必须与下面路由前缀一致：handler 内部按它剥前缀
  title: "order-service",
  auth: { users: { ops: process.env.CONSOLE_PASSWORD! }, secret: process.env.CONSOLE_SECRET! },
  logFiles: createLogFiles({ dir: "logs" }),   // 不给的话 log.list 用不了
});

// 先注册控制台，再注册业务中间件：app.use 只作用于它之后注册的路由。
app.all("/shell", (c) => shell.handler(c.req.raw));
app.all("/shell/*", (c) => shell.handler(c.req.raw));
```

两条路由缺一不可：`/shell` 是页面，`/shell/*` 是 `/events`、`/exec`、`/log/:name`。只挂一条的话页面能打开，登录和命令全是 404。

`auth.users` 非空即服务端模式；`user: "local"` 是「能看到页面的人本来就能碰这个进程」时才用的本机开关，绑 `0.0.0.0` 或公网时不能用。其它框架（Express / Fastify / 裸 `node:http`）用 `@needle/shell/node` 的 `attach(server, shell, { basePath: "/shell" })`；平台细节见「三、平台支持」指向的三篇。

### 跑一遍

```bash
bun examples/demo.ts    # http://127.0.0.1:1234/shell，账号 xmli / 123456
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
- **`@needle/shell` 依赖 `@needle/logo`，版本要一致。** 两个包版本号同步递增；混用两个不同版本的 logo 会有两份副本，`logo` 变成两个对象，各自的 sink 互不可见。

## 开发

`dist/` 随源码一起提交，这样 git 依赖不需要构建步骤就能用。克隆后执行一次 `git config core.hooksPath .githooks`，之后每次提交都会自动重建 `dist/` 并 stage 进同一个 commit。
