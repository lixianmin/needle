# @needle/logo

线上排障不用再 `docker exec` 进去 `tail -f`。给 Node 服务（或 Workers）挂一个浏览器控制台：看实时日志、敲命令查状态、订阅周期性指标。零运行时依赖。

```
浏览器  ──SSE──▶  你的进程
   │                │
   └──POST /exec────┘
```

## 一行日志

```ts
import { logo } from "@needle/logo";

logo.info("order created", { orderId: 42 });
// sink 收到的记录：{"orderId":42,"time":1758991234567,"level":"info","msg":"order created"}
// stdout 实际写的一行：2026-10-23T10:50:43 [I] {"orderId":42,"msg":"order created"}

logo.error("paid failed", err, { userId: 7 });   // Error 展开成 message + stack
```

字符串拼成 `msg`，对象合并进字段，`Error` 展开成 `message` + `stack`。`warn`/`error` 立即落盘，`info` 攒批（默认 100ms），一个循环写 1000 条也只产生一次 IO。

```ts
const db = logo.child({ name: "db", traceId: "t1" });
db.info("connected");
```

`logo` 是库给的默认实例，开箱写 stdout。要另建一个（换级别、换名字、换 sink 组合）用 `newLogger()`——名字对齐 Go 版 logo 的 `NewLogger`。

## 日志写到哪去

`sinks` 只是**初始**列表，文件、飞书都是事后挂上去的：

```ts
import { logo } from "@needle/logo";
import { createFileSink } from "@needle/logo/node";
import { createLarkSink } from "@needle/logo/lark";

logo.addSink(createFileSink({ dir: "logs" }));                    // 落盘，按级别分文件
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!,    // 推到飞书
                              minLevel: "error" }));

process.on("SIGTERM", () => logo.dispose());   // 退出前冲掉缓冲区
```

`removeSink` 摘掉；`newLogger({ sinks: [...] })` 一步配好。

## 基础数据结构

`sorted table` 从 unicorn 的 C# 实现移植过来：键值并行数组始终按 key 有序，
查找二分，遍历天然是排好序的。

```ts
import { SortedTable } from "@needle/logo";

const table = new SortedTable<number, string>();
table.add(5, "e");
table.add(1, "a");
console.log([...table.keysIter()]);   // [1, 5]

table.set(3, "c");                    // 插入或覆盖
table.tryGet(9);                      // undefined
```

读多写少、需要顺序遍历时用它；高频随机插入的大表用 `Map`。

## 挂一个控制台

控制台对外只有一个接口：`debug.handler`，签名为 `(req: Request) => Promise<Response>`。
挂载就是把这一个函数接到你的服务器上，两条路：**自己起端口**或 **挂到已有 server**。

先建控制台（`basePath` 要和下面路由前缀一致，handler 内部按它剥前缀）：

```ts
import { logo } from "@needle/logo";
import { createConsole } from "@needle/logo/console";

const debug = createConsole({
  logger: logo,
  title: "my-service",          // 头栏与浏览器标签页显示的项目名，默认 "console"
  basePath: "/console",
  auth: { users: { xmli: "123456" }, secret: process.env.DBG_SECRET },
});
```

**1. 自己起一个端口**（纯 Node，不碰你现有的服务）：

```ts
import { serve } from "@needle/logo/node";

const running = await serve(debug.handler, { port: 7701 });   // 打开 :7701/console
```

**2. 挂到已有的 node:http server** —— 裸 Node、Express、Fastify 底层都是它：

```ts
import { attach } from "@needle/logo/node";

attach(server, debug, { basePath: "/console" });   // server = http.createServer(app)
server.listen(3000);
```

`attach` 接管 `request` 事件：`/console` 与 `/console/*` 交给控制台，其余请求按原顺序交回
你原来的 listener，所以已有的 app / 中间件一行都不用改。控制台不经过它们（也不受它们的
body 解析、鉴权影响）——`/exec`、`/events` 有自己的 token 校验。

**3. Hono** —— 两行，不需要 needle 提供入口，也不依赖 Hono：

```ts
app.all("/console", (c) => debug.handler(c.req.raw));
app.all("/console/*", (c) => debug.handler(c.req.raw));
```

**4. Bun.serve / Cloudflare Workers** —— 它们本来就收 `fetch`，判断一下前缀：

```ts
const isConsole = (request: Request) => {
  const path = new URL(request.url).pathname;
  return path === "/console" || path.startsWith("/console/");
};

Bun.serve({ fetch: (req) => (isConsole(req) ? debug.handler(req) : app.fetch(req)) });

export default {
  fetch: (req, env, ctx) => (isConsole(req) ? debug.handler(req) : app.fetch(req, env, ctx)),
};
```

**5. React Router v7（框架模式）** —— 建两个资源路由，`/console` 与 `/console/*` 各一个
（`app/routes/console.ts` 和 `app/routes/console.$.ts`），两个文件内容一样：

```ts
export function loader({ request }: { request: Request }) {
  return debug.handler(request);      // GET：页面、SSE、日志文件
}

export function action({ request }: { request: Request }) {
  return debug.handler(request);      // POST：/exec、/auth
}
```

`loader` 和 `action` 缺一不可：只写 `loader` 的话页面能打开，但登录和控制台命令（POST）全是 405。

任何能拿到 `(Request) => Response` 的地方（Deno、Netlify、Vercel Functions 等）同理，直接把
`debug.handler` 接上去就行。

打开控制台（上面各例的端口 + `basePath`，例如 `http://localhost:3000/console`）：

```
$ help
help              列出所有命令
log.list          列出日志文件（点文件名看全文）
top               看一眼进程指标
auth <user>       登录（下一步提示输密码，输入不回显）

$ auth xmli
密码:            # 这里输入不回显，不进历史

$ he<Tab>         # Tab 补全命令名（候选来自服务端命令表，自定义命令也在内）
$ sub t<Tab>     # 第二个词补主题名
$ log.list
```

未登录时只能跑 `help` / `auth` / `sub` / `unsub`。日志流本身也要鉴权——那里什么都有。

登录态是带 `exp` 的签名 token，默认 12 小时过期（`auth.ttlMs` 可调）；过期后控制台回到未登录，重新 `auth` 即可。

口令是两步的：`auth <user>` 回车后输入框切成 `type=password`，密码不回显、不进历史、也不作为命令行内容发给服务端（走独立的 `POST /auth`）。这是把它和密码分开的唯一理由。

自定义命令：

```ts
createConsole({
  logger: logo,
  auth: { users: { xmli: "123456" } },
  commands: [
    {
      name: "room",
      note: "查看房间状态",
      args: "<id>",
      run: async ({ args }) => ({
        kind: "table",
        columns: ["key", "value"],
        rows: Object.entries(rooms.get(args[0]) ?? {}),
      }),
    },
  ],
});
```

输出只有三种形态：`text` / `table` / `json`，前端照着渲染，不用解析字符串。表格可以给每列声明语义（`auto` / `bytes` / `duration` / `number`）：字节走 `toHuman`（`36290560` → `34.61M`，对齐 got 的 `convert.ToHuman`），毫秒走 `formatDuration`（`57720` → `57.7s`），点表头按原始数值排序。

## 浏览器与 Chrome 扩展

同一套控制台，挂在 DOM 上而不是 HTTP 上：

```ts
import { logo } from "@needle/logo";
import { createBrowserConsole } from "@needle/logo/console";

const panel = createBrowserConsole({
  logger: logo,
  auth: { users: {} },     // 浏览器里没有鉴权意义，能看到页面就能碰到这个进程
  user: "local-dev",
  element: document.getElementById("debug")!,
});
```

Chrome 扩展的 popup / devtools 面板同样适用——UI 是 DOM 构建，不注入内联脚本，不受 MV3 的 CSP 限制。

## 写文件与推飞书

```ts
import { createFileSink } from "@needle/logo/node";
import { createLarkSink } from "@needle/logo/lark";

// 按级别分文件并级联：info.log 收 info/warn/error，warn.log 收 warn/error，error.log 只收 error
logo.addSink(createFileSink({ dir: "logs", maxBytes: 10 * 1024 * 1024 }));
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!, minLevel: "error" }));
```

进程退出前调 `logo.dispose()`，否则缓冲区里最后一批会丢。

## 本地跑一遍

```bash
bun examples/demo.ts
```

打开 <http://127.0.0.1:1234/console>，账号 `xmli` / `123456`。

- `log.list` 列出日志文件，`top` 看进程指标，`room` 看演示业务状态，`io` 演示表格排序，`burst 200` 连写 200 条看批量与实时推送。
- `sub top 2000` 订阅指标（每条落一行，不是常驻面板），`unsub top` 取消，`unsub` 取消全部。
- `boom` 故意抛错：服务端 stderr 里能看到"info 抢在 error 之前写出去"，且 error 带调用栈。
- `slow` 睡 12 秒，会被 10 秒超时截断。
- 未登录时只有 `help` / `auth` 可用，日志流也拉不到——这是设计，不是 bug。

## Cloudflare Workers

```ts
export default { fetch: createConsole({ logger: logo, auth }).handler };
```

不需要改代码、不需要 Durable Object。限制（日志视图只覆盖当前 isolate、没有 CPU 读数、没有文件 sink）见 [docs/deploy/workers.md](docs/deploy/workers.md)。

## 体积

| 入口 | min+gzip |
|---|---|
| `.`（日志） | 1.7 KB |
| `./console`（控制台，含内联页面脚本） | 9.2 KB |

`bun run size` 可复现。运行时依赖为零。

## 常见坑

踩过的，按「现象 → 原因 → 怎么办」写。

- **记录里没有 `message`，字段叫 `msg`。** 只有传 `Error` 时才会出现 `message`（展开成 `message` + `stack`）；普通日志判正文用 `msg`，别读 `record.message`。
- **`time` / `level` 不在打印出来的 JSON 里。** 落盘行是 `2026-10-23T10:50:43 [I] {…}`：时间与级别只在前缀，JSON 里只有业务字段与 `msg`；记录的 `time` 是 **epoch 毫秒数字**。`parseLine()` 也只还原 JSON 那段。时间固定 `+08:00`，与机器 `TZ` 无关。
- **只有 `warn` / `error` 默认带 `stack`。** `stackLevel` 默认 `warn`；要 info 也带用 `newLogger({ stackLevel: "info" })`，关掉用 `"off"`。传 `Error` 时用的是 Error 自己的栈（抛出点），不是调用点。
- **`info` 不会立刻到 sink。** 默认 100ms 攒批：测试/脚本里断言 sink 之前先 `flush()`。`warn` / `error` 立即写出，并把积压一起带出去。
- **Node 里 spy `console.log` 抓不到日志。** 有 `process.stdout.write` 时 stdout sink 直接写 stdout。要断言就 `addSink` 自己的函数，别 spy `console`。
- **`logo` 没有 `name`。** 记录里就没有 `name` 字段；`newLogger({ name })` 与 `child({ name })` 才有。想按来源过滤就自己加业务字段。
- **信封字段会被丢弃。** `info("x", { level: "error", time: 1, msg: "fake", name: "y" })` 记成 `{level:"info", msg:"x", time:<now>}`——业务对象不能伪造 `time` / `level` / `msg` / `name` / `stack`。
- **非纯对象进 `msg`，不进字段。** 数组、`Date`、`Map`、类实例都会序列化后拼进 `msg`；要可查询的字段就传纯对象。
- **`child()` 会快照 sink。** 建 child 之后再给父级 `addSink`，子实例收不到。要统一落点就在启动早期建 child，或直接给 child 挂。
- **`dispose()` 之后日志静默丢弃。** 它先 `flush()` 再 `close()` 各 sink（`FileSink` 关闭后写不进）；退出前调一次即可，别在长生命周期进程里早调。
- **`@needle/logo/node` 不能进浏览器 / Workers 打包。** 它顶层 `import "node:fs"`；core 的 `.` 入口是干净的，文件 sink 只能在 Node 侧挂。
- **git 依赖不会自己跟 main。** lockfile 钉住 sha 后 `bun install` 不会动，升级要 `bun update @needle/logo`。两方 spec 不同但解析到同一 sha 时只装一份（bun 按解析结果去重）；不同 sha 才是两份副本——那时 `logo` 会变成两个对象，各自的 sink 互不可见。

## 设计取舍

- **SSE 而不是 WebSocket**：Node 要装 `ws`、Bun 要在 `serve()` 里传 `websocket`、Workers 必须有 Durable Object。SSE 只要一个 `(Request) => Response`，三处零配置。
- **batch sink 而不是逐条**：1000 条日志 = 1 次 IO。`warn`/`error` 例外，立即写，且把积压的一起带出去。
- **控制台拆成 kernel + 适配器**：同一套命令在服务器上走 HTTP/SSE，在浏览器里直调，不会出现两份实现。

设计文档见 `docs/superpowers/specs/2026-10-22-logo-design.md`。

## 开发

`dist/` 随源码一起提交，这样 `git+https://github.com/lixianmin/needle.git` 这类依赖不需要构建步骤就能用。本地克隆后执行一次 `git config core.hooksPath .githooks`，之后每次提交都会自动重建 `dist/` 并 stage 进同一个 commit。
