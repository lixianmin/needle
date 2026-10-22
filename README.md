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
  auth: { users: { admin: "secret" }, secret: process.env.DBG_SECRET },
  basePath: "/__dbg",
});

// 复用现有服务：handler 就是一个 (Request) => Response
declare const yourHandler: (req: Request) => Promise<Response>;
await serve((req) =>
  new URL(req.url).pathname.startsWith("/__dbg") ? debug.handler(req) : yourHandler(req),
  { port: 3000 },
);
```

打开 `http://localhost:3000/__dbg`：

```
$ help
help              列出所有命令
logs [n]          查看最近的日志
ps                查看进程指标
env [pattern]     查看环境变量（默认打码）
login <user> <pwd> 登录以获取完整权限
logout            清除本地登录态

$ login admin secret
$ logs 20
```

未登录时只能跑 `help` / `login` / `logout`。日志流本身也要鉴权——那里什么都有。

自定义命令：

```ts
createConsole({
  logger: logo,
  auth: { users: { admin: "secret" } },
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

输出只有三种形态：`text` / `table` / `json`，前端照着渲染，不用解析字符串。

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
