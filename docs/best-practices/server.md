# 服务端（Node / Bun）

控制台和日志在这里都是全功能，唯一的平台差异是有没有文件系统：

| runtime | 文件 sink |
|---|---|
| Node / Bun | 有 |
| Cloudflare Workers | 无（见 [../deploy/workers.md](../deploy/workers.md)） |

## 一、挂到 HTTP 框架

控制台对外只有一个接口：`(req: Request) => Promise<Response>`。Hono 是两条路由：

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createLogFiles } from "@needle/logo/node";
import { createShell } from "@needle/shell";

const app = new Hono();

const shell = createShell({
  basePath: "/shell",
  auth: { users: { admin: process.env.CONSOLE_PASSWORD! }, secret: process.env.CONSOLE_SECRET! },
  logFiles: createLogFiles({ dir: "logs" }),
});

app.all("/shell", (c) => shell.handler(c.req.raw));
app.all("/shell/*", (c) => shell.handler(c.req.raw));

const server = serve({ fetch: app.fetch, port: 3000 });
```

三处容易写错：

- **两条路由缺一不可。** `/shell` 是页面，`/shell/*` 是 `/events`、`/exec`、`/log/:name`。只挂一条的话页面能打开，登录和命令全 404。
- **`basePath` 与路由前缀必须一致。** handler 内部按它剥前缀：`/shell/log/info.log` → `/log/info.log`。
- **控制台注册在业务中间件之前。** 它自带 token 校验，不该被 CORS、body 解析、登录态中间件影响；注册在它之前的 `app.use("*")` 会把 `/shell` 一起拦掉。

Express / Fastify / 裸 `node:http` 用 `@needle/shell/node` 的两个函数，已有 app 一行不用改：

```ts
import { attach, serve } from "@needle/shell/node";

await serve(shell.handler, { port: 7701 });            // 自己起端口
attach(server, shell, { basePath: "/shell" });         // 挂到已有 http server
```

`attach` 接管 `request` 事件：前缀内交给控制台，前缀外交回原 listener。

## 二、鉴权

| 配置 | 行为 | 适用 |
|---|---|---|
| `auth: { users, secret }` | `auth admin` + 密码换 token | 对外暴露的部署 |
| `auth: { users: {} }, user: "local"` | 跳过 token，谁打开页面就是谁 | 只绑 `127.0.0.1` 的本机进程 |

- **`secret` 必须显式传且来自环境变量。** 不传就随机生成，重启后所有 token 失效；多进程共享登录态也要求同一个 secret。
- **绑 `0.0.0.0` / 局域网 / 公网时不能用 `user`。** 那个开关的前提是「能打开页面的人本来就能碰这个进程」，绑非回环地址时前提不成立。
- **`users` 留空不等于免登录，等于谁都登不进去。** 页面能开，但非 public 命令全是 401。
- token 是 HMAC-SHA256，默认 12 小时（`auth.ttlMs`）；口令走独立的 `POST /auth`，所以密码不进命令行、不进历史。

## 三、日志与 `log.list`

- **`createLogFiles({ dir })` 的目录必须与 file sink 的 `dir` 相同**，否则 `log.list` 列的是另一个空目录。
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

## 四、Workers

不用改代码，但有三处与 Node 不同（展开见 [../deploy/workers.md](../deploy/workers.md)）：

- `auth.secret` 必须固定，否则 isolate 重建后表现为「刚登录完又要登录」。
- 没有文件系统：`createFileSink` 不可用，`log.list` 没有目录可读。
- 批量刷新自动关闭：定时器可能被平台取消，库改为逐条立即写出（等价 `batch: false`）。
