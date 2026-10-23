# 服务端部署（Node / Bun 与 Cloudflare Workers）

Shell 和日志在服务端都是全功能，唯一的平台差异是有没有文件系统：

| runtime | 文件 sink | 挂载方式 |
|---|---|---|
| Node / Bun | 有 | 任意 HTTP 框架，或 `node:http` |
| Cloudflare Workers | 无 | `export default { fetch }` |

前三节是 Node / Bun 的做法，第四节是 Cloudflare Workers——同一套代码，不用为它改。

## 一、挂到 HTTP 框架

Shell 对外只有一个接口：`(req: Request) => Promise<Response>`。Hono 挂一条通配就够：

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createLogFiles } from "@needle/needle/node";
import { createServerShell } from "@needle/needle/shell";

const app = new Hono();

const shell = createServerShell({
  basePath: "/shell",
  auth: { users: { admin: process.env.SHELL_PASSWORD! }, secret: process.env.SHELL_SECRET! },
  logFiles: createLogFiles({ dir: "logs" }),
});

app.all("/shell/*", (c) => shell.handler(c.req.raw));

const server = serve({ fetch: app.fetch, port: 3000 });
```

四处容易写错：

- **通配要盖住所有子路径。** Shell 的端点都在 `basePath` 下面：`/events`（SSE）、`/exec`（执行命令）、`/auth`（登录）、`/log/:name`（取日志文件）、`/health`。只把页面那一条交给 Shell，登录和命令全 404。
- **有的框架通配不匹配基路径。** Hono 的 `/shell/*` 连 `/shell` 本身也命中（实测），一条就够；Express 4 的通配不匹配 `/shell`（实测 404），那种框架要再补一条 `app.all("/shell", ...)`。
- **`basePath` 与路由前缀必须一致。** handler 内部按它剥前缀：`/shell/log/info.log` → `/log/info.log`。
- **Shell 注册在业务中间件之前。** 它自带 token 校验，不该被 CORS、body 解析、登录态中间件影响；注册在它之前的 `app.use("*")` 会把 `/shell` 一起拦掉。

Express / Fastify / 裸 `node:http` 用 `@needle/needle/node` 的两个函数，已有 app 一行不用改：

```ts
import { attach, serve } from "@needle/needle/node";

await serve(shell.handler, { port: 7701 });            // 自己起端口
attach(server, shell, { basePath: "/shell" });         // 挂到已有 http server
```

`attach` 接管 `request` 事件：前缀内交给 Shell，前缀外交回原 listener。

## 二、鉴权

| 配置 | 行为 | 适用 |
|---|---|---|
| `auth: { users, secret }` | `auth admin` + 密码换 token | 对外暴露的部署 |
| `auth: { users: {} }, user: "local"` | 跳过 token，谁打开页面就是谁 | 只绑 `127.0.0.1` 的本机进程 |

- **`secret` 必须显式传且来自环境变量。** 不传就随机生成，重启后所有 token 失效；多进程共享登录态也要求同一个 secret。
- **绑 `0.0.0.0` / 局域网 / 公网时不能用 `user`。** 那个开关的前提是「能打开页面的人本来就能碰这个进程」，绑非回环地址时前提不成立。
- **`users` 留空不等于免登录，等于谁都登不进去。** 页面能开，但除 `auth` / `help` 外全是 401。
- token 是 HMAC-SHA256，默认 12 小时（`auth.ttlMs`）；口令走独立的 `POST /auth`，所以密码不进命令行、不进历史。
- **`/auth` 没有内置失败次数限制。** 公网部署时在前面挂一层限流，否则口令可被爆破。

## 三、日志与 `log.list`

- **`createLogFiles({ dir })` 的目录必须与 file sink 的 `dir` 相同**，否则 `log.list` 列的是另一个空目录。
-Shell 只暴露 `.log`、拒绝符号链接、单文件超过 8MB 不读；但目录里的硬链接没法与真实日志区分，日志目录不要放别的东西。
- `createFileSink` 默认 `maxBytes` 10MB、`keepDays` 7 天、`minLevel` `info`，于是只有 `info.log` / `warn.log` / `error.log`，级联收录（`error.log` 只收 error）。要 `debug.log` 传 `minLevel: "debug"`。
- 退出时顺序不能反：

```ts
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    logo.dispose();                                   // 先冲日志
    void server.close().then(() => process.exit(0));  // 再关连接
  });
}
```

## 四、Cloudflare Workers

不用改代码，但有三处与 Node 不同：

- `auth.secret` 必须固定，否则 isolate 重建后表现为「刚登录完又要登录」。
- 没有文件系统：`createFileSink` 不可用，`log.list` 没有目录可读。
- 批量刷新自动关闭：定时器可能被平台取消，库改为逐条立即写出（等价 `batch: false`）。

### 先看结论

`@needle/needle` 在 Workers 上能直接跑，**不需要为 Workers 改代码**，也不需要 Durable Object、不需要额外配置。代价是有几项能力在这类环境里拿不到，下面逐条说明。

### 最小部署

```ts
// src/index.ts
import { createServerShell } from "@needle/needle/shell";
import { logo } from "@needle/needle";

const shell = createServerShell({
  auth: {
    users: { admin: process.env.SHELL_PASSWORD! },
    secret: process.env.SHELL_SECRET!,   // 必须固定，见下
  },
  version: "1.0.0",
});

export default {
  fetch(request: Request) {
    return shell.handler(request);
  },
};
```

wrangler 只需要常规配置：

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-06"
}
```

`SHELL_SECRET` 用 `wrangler secret put` 注入。

### 必须固定 secret

token 是 HMAC 签名的，secret 变了旧 token 就作废。Workers 的 isolate 随时会被回收重建，如果让库随机生成 secret，每次回收都会把已登录的浏览器踢掉——表现为“刚登录完又要登录”。

```ts
auth: { users: {...}, secret: env.SHELL_SECRET }   // 不要省略
```

### Workers 上能看到什么

| 能力 | Node | Workers |
|---|---|---|
| `logo.*` 日志 | 完整 | 完整 |
| stdout sink | 写 stdout | 退化为 `console.log` |
| 文件 sink | 有 | 无（没有文件系统） |
| 飞书 sink | 有 | 有（走 fetch） |
| Shell 页面 / SSE | 有 | 有 |
| 右栏实时日志 | 有 | 有（只覆盖当前 isolate，别的实例看不到） |
| 命令执行 | 完整 | 完整 |
| CPU / 内存指标 | 真实读数 | 自维护计数器 |
| 登录态 | 随进程重启失效 | 随 isolate 回收失效（配了固定 secret 后由 token 有效期兜底） |

### 日志怎么拿出去

Shell 右栏只在面板打开时收实时日志，没有历史；Workers 又没有文件系统，所以事后查只能靠 sink 出去：

- `createLarkSink` 把 `error` 推到飞书，最省事。
- 平台侧的 Logpush / Tail Workers 收 stdout。
- 自己的 sink 往外部收集端发。

要按文件查日志，用 Node / Bun——那里才有 `createFileSink` 和 `log.list`。

### 为什么不做定时批量

`logo` 的批量刷新依赖定时器。Workers 的响应返回后，未触发的定时器可能被取消——批量反而会丢日志。库的做法是：检测不到可同步写的 stdout 时，日志逐条立即写出。这条规则同样适用于 Vercel Edge、Deno Deploy 这类环境。

### 已知的环境限制

- **不能用非字面量的 `import()`**：workerd 要求静态模块说明符。库内部已经没有任何动态 import（这条是 miniflare 集成测试抓出来的）。
- **CPU 时间有限**：Shell 的命令走同一套执行路径，一个跑太久的命令会被 HTTP 超时（默认 10 秒）截断。
- **SSE 长连接**：Workers 的 HTTP 请求没有 wall time 上限，订阅的主题可以一直推；客户端断线后需要重连，前端已经带了指数退避。

### 验证过什么

`test/integration/workers.test.ts` 用 miniflare（真实的 workerd）跑过：页面渲染、公开命令、登录、`top` 返回 `runtime: "workers"`、SSE 鉴权与建流。不是“文档说可以”，是跑过的。
