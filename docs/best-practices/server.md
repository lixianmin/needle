# 服务端

控制台和日志在这里都是全功能。唯一的差别是 runtime 有没有文件系统：

| 跑在 | 控制台 | 文件 sink | 日志视图 |
|---|---|---|---|
| Node（`@hono/node-server`） | HTTP + SSE | 有 | 全进程 |
| Bun（`Bun.serve({ fetch: app.fetch })`） | HTTP + SSE | 有 | 全进程 |
| Cloudflare Workers | HTTP + SSE | 无 | 仅当前 isolate |

下文以 Hono 为例；Express / Fastify / 裸 `node:http` 见最后一节。

## 控制台

### 接线

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createConsole, logo } from "@needle/logo";
import { createLogFiles } from "@needle/logo/node";

const app = new Hono();

const debug = createConsole({
  logger: logo,
  basePath: "/console",
  title: "order-service",
  version: process.env.APP_VERSION,
  auth: { users: { ops: process.env.CONSOLE_PASSWORD! }, secret: process.env.CONSOLE_SECRET! },
  logFiles: createLogFiles({ dir: "logs" }),
});

// 先注册控制台，再注册业务中间件 —— app.use 只作用于它之后注册的路由。
app.all("/console", (c) => debug.handler(c.req.raw));
app.all("/console/*", (c) => debug.handler(c.req.raw));

app.use("*", async (c, next) => { /* traceId、业务鉴权…… */ });
app.get("/orders/:id", (c) => c.json({ id: c.req.param("id") }));

const server = serve({ fetch: app.fetch, port: 3000 });
```

三处容易写错：

- **两条路由缺一不可。** `/console` 是页面，`/console/*` 是 `/events`、`/exec`、`/log/:name`。只挂一条的话页面能打开，登录和命令全是 404。
- **`basePath` 与路由前缀必须一致。** handler 内部按它剥前缀：`/console/log/info.log` → `/log/info.log`。
- **控制台注册在业务中间件之前。** 它自带 token 校验，不该被 CORS、body 解析、登录态中间件影响。反过来，注册在它之前的 `app.use("*")` 会连 `/console` 一起拦掉。

### 鉴权

| 配置 | 行为 | 适用 |
|---|---|---|
| `auth: { users, secret }` | 服务端模式：`auth ops` + 密码换 token | 所有对外暴露的部署 |
| `auth: { users: {} }, user: "local"` | 跳过 token，谁打开页面就是谁 | 只绑 `127.0.0.1` 的本机进程 |

- **`secret` 必须显式传且来自环境变量。** 不传就随机生成，重启后所有已签发 token 失效；多进程共享登录态也要求同一个 secret。
- **绑 `0.0.0.0` / 局域网 / 公网时不能用 `user` 开关。** 那个开关的前提是「能打开页面的人本来就能碰这个进程」；绑非回环地址时前提不成立，同网段任何设备都能读全部日志、执行命令。
- **`users` 留空不等于免登录，等于谁都登不进去。** `login()` 恒返回 null，页面能开，但非 public 命令全是 401。
- token 是 HMAC-SHA256，默认 12 小时（`auth.ttlMs`）。口令走独立的 `POST /auth`（请求体上限 512 字节），所以密码不进命令行、不进历史；绕过 UI 直接 `POST /exec` 发 `auth ops 密码` 会被拒掉。

### 命令

命令在进程内跑，能直接读内存状态，所以写「业务此刻长什么样」，而不是「再打印一遍日志」：

```ts
commands: [{
  name: "order",
  note: "按 id 看订单状态",
  args: "<id>",
  run: async ({ args }) => ({ kind: "json", value: await orders.get(args[0]!) }),
}]
```

- 查日志用 `log.list`（读 `logFiles` 指向的目录），别指望页面里的实时滚动：只有最近 500 行，量大就淹，也不留档。
- 输出只有 `text` / `table` / `json`。要人读的排成 `table`，要贴给别人的用 `json`。
- 表格列可声明语义：`bytes` 走 `toHuman`（`36290560` → `34.61M`），`duration` 走 `formatDuration`（`57720` → `57.7s`），点表头按原始数值排序。
- 超时默认 10 秒（`timeoutMs`），超了返回 `timeout`，不会把请求挂住。
- 出错直接抛，适配器把消息回给控制台；想让服务端 stderr 也留一条，抛之前先 `logo.error`。
- `topics` 供 `sub <name>` 订阅，默认有 `top`（进程指标）与 `mem`。给业务加一个 `queue` 主题，比让人反复敲命令省事。

## 日志

### 初始化

默认实例够用时，直接用：

```ts
import { logo, createLarkSink } from "@needle/logo";
import { createFileSink } from "@needle/logo/node";

logo.info("order created", { orderId: 42 });

logo.addSink(createFileSink({ dir: "logs" }));                                       // 按级别分文件
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!, minLevel: "error" })); // error 推飞书
process.on("SIGTERM", () => logo.dispose());
```

要换级别、换名字，就自己建一个，把 sink 一起传进去：

```ts
import { newLogger } from "@needle/logo";

const log = newLogger({ name: "order-service", level: "info", sinks: [createFileSink({ dir: "logs" })] });
```

- 默认级别 `info`，`debug` 要 `setLevel("debug")` 才出来。
- `createFileSink` 默认 `maxBytes` 10MB、`keepDays` 7 天、`minLevel` `info`，于是只有 `info.log` / `warn.log` / `error.log`，级联收录（`error.log` 只收 error）。要 `debug.log` 传 `minLevel: "debug"`。
- `createLogFiles({ dir })` 的目录必须与 file sink 的 `dir` 相同，否则 `log.list` 列的是另一个空目录。
- 只记日志、不要控制台时，只 import `@needle/logo`（2.7 KB），别碰 `./console`。

### 退出

`dispose()` 先 `flush()` 再 `close()` 各 sink，顺序不能反：

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

`dispose()` 之后日志静默丢弃，别在长生命周期进程里早调。SSE 连接不用手动清：浏览器断开时读端 `cancel` 会摘除订阅者并清掉所有 interval。

## Workers

控制台和日志都能跑，不用改代码、不需要 Durable Object，但有三处与 Node 不同（展开见 [../deploy/workers.md](../deploy/workers.md)）：

- **`auth.secret` 必须固定。** isolate 会被回收重建，随机 secret 表现为「刚登录完又要登录」。
- **没有文件系统。** 不传 `logFiles`，`log.list` 用不了；日志视图只覆盖当前 isolate，跨 isolate 要 Durable Object 或 Logpush。
- **批量刷新自动关闭。** 响应返回后未触发的定时器可能被取消，库探测不到可同步写的 stdout 时改为逐条立即写出（等价 `batch: false`），不用手配。

## 别的 HTTP 框架

`@needle/logo/node` 有两个函数，Express / Fastify / 裸 `node:http` 都能用（实现见 `src/node/serve.ts`）：

```ts
import { attach, serve } from "@needle/logo/node";

await serve(debug.handler, { port: 7701 });                  // 自己起端口
attach(server, debug, { basePath: "/console" });             // 挂到已有 http server
```

`attach` 接管 `request` 事件：前缀内交给控制台，前缀外按原顺序交回原 listener，已有 app 一行都不用改。
