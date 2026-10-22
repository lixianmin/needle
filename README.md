# @noodle/logo

线上排障不用再 `docker exec` 进去 `tail -f`。给 Node 服务（或 Workers）挂一个浏览器控制台：看实时日志、敲命令查状态、订阅周期性指标。零运行时依赖。

```
浏览器  ──SSE──▶  你的进程
   │                │
   └──POST /exec────┘
```

## 一行日志

```ts
import { logo } from "@noodle/logo";

logo.info("order created", { orderId: 42 });
// {"time":1758991234567,"level":"info","msg":"order created","orderId":42}

logo.error("paid failed", err, { userId: 7 });   // 自动带调用栈
```

字符串拼成 `msg`，对象合并进字段，`Error` 展开成 `message` + `stack`。`warn`/`error` 立即落盘，`info` 攒批（默认 100ms），一个循环写 1000 条也只产生一次 IO。

```ts
const logger = logo.child({ name: "db", traceId: "t1" });
logger.info("connected");
```

## 挂一个控制台

```ts
import http from "node:http";
import { logo } from "@noodle/logo";
import { createConsole } from "@noodle/logo/console";
import { serve } from "@noodle/logo/node";

const debug = createConsole({
  logger: logo,
  title: "my-service",          // 头栏与浏览器标签页显示的项目名，默认 "console"
  basePath: "/console",
  auth: { users: { xmli: "123456" }, secret: process.env.DBG_SECRET },
});

// 复用现有服务：handler 就是一个 (Request) => Response
declare const yourHandler: (req: Request) => Promise<Response>;
await serve((req) =>
  new URL(req.url).pathname.startsWith("/console") ? debug.handler(req) : yourHandler(req),
  { port: 3000 },
);
```

打开 `http://localhost:3000/console`：

```
$ help
help              列出所有命令
logs [n]          查看最近的日志
top               看一眼进程指标
auth <user>       登录（下一步提示输密码，输入不回显）
logout            清除本地登录态

$ auth xmli
密码:            # 这里输入不回显，不进历史

$ he<Tab>         # Tab 补全命令名（候选来自服务端命令表，自定义命令也在内）
$ sub t<Tab>     # 第二个词补主题名
$ logs 20
```

未登录时只能跑 `help` / `auth` / `logout`。日志流本身也要鉴权——那里什么都有。

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

输出只有三种形态：`text` / `table` / `json`，前端照着渲染，不用解析字符串。表格里的数字按人话显示（`36290560` → `34.61M`，行为对齐 got 的 `convert.ToHuman`），点表头按原始数值排序，再点一次反向。

## 浏览器与 Chrome 扩展

同一套控制台，挂在 DOM 上而不是 HTTP 上：

```ts
import { logo } from "@noodle/logo";
import { createBrowserConsole } from "@noodle/logo/console";

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
import { createFileSink } from "@noodle/logo/node";
import { createLarkSink } from "@noodle/logo/lark";

logo.addSink(createFileSink({ dir: "logs", maxBytes: 10 * 1024 * 1024 }));
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!, minLevel: "error" }));
```

进程退出前调 `logo.dispose()`，否则缓冲区里最后一批会丢。

## 本地跑一遍

```bash
bun examples/demo.ts
```

打开 <http://127.0.0.1:1234/console>，账号 `xmli` / `123456`。

- `logs 20` 看历史，`top` 看进程指标，`room` 看演示业务状态，`io` 演示表格排序，`burst 200` 连写 200 条看批量与实时推送。
- `sub top 2000` 订阅指标（每条落一行，不是常驻面板），`unsub top` 取消，`unsub` 取消全部。
- `boom` 故意抛错：服务端 stderr 里能看到"info 抢在 error 之前写出去"，且 error 带调用栈。
- `slow` 睡 12 秒，会被 10 秒超时截断。
- 未登录时只有 `help` / `login` / `logout` 可用，日志流也拉不到——这是设计，不是 bug。

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

## 设计取舍

- **SSE 而不是 WebSocket**：Node 要装 `ws`、Bun 要在 `serve()` 里传 `websocket`、Workers 必须有 Durable Object。SSE 只要一个 `(Request) => Response`，三处零配置。
- **batch sink 而不是逐条**：1000 条日志 = 1 次 IO。`warn`/`error` 例外，立即写，且把积压的一起带出去。
- **控制台拆成 kernel + 适配器**：同一套命令在服务器上走 HTTP/SSE，在浏览器里直调，不会出现两份实现。

设计文档见 `docs/superpowers/specs/2026-10-22-logo-design.md`。
