# 在 Cloudflare Workers 上部署

## 先看结论

`@needle/logo` 的核心与控制台在 Workers 上能直接跑，**不需要为 Workers 改代码**，也不需要 Durable Object、不需要额外配置。代价是有几项能力在这类环境里拿不到，下面逐条说明。

## 最小部署

```ts
// src/index.ts
import { createConsole, logo } from "@needle/logo";

const debug = createConsole({
  logger: logo,
  auth: {
    users: { admin: process.env.CONSOLE_PASSWORD! },
    secret: process.env.CONSOLE_SECRET!,   // 必须固定，见下
  },
  version: "1.0.0",
});

export default {
  fetch(request: Request) {
    return debug.handler(request);
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

`CONSOLE_SECRET` 用 `wrangler secret put` 注入。

登录走 `POST /auth`（body `{ user, password }`），页面上的 `auth <user>` 会先提示输入密码，回车后调这个接口。密码不会出现在命令行文本、浏览器历史或服务端日志里。

## 必须固定 secret

token 是 HMAC 签名的，secret 变了旧 token 就作废。Workers 的 isolate 随时会被回收重建，如果让库随机生成 secret，每次回收都会把已登录的浏览器踢掉——表现为"刚登录完又要登录"。

```ts
auth: { users: {...}, secret: env.CONSOLE_SECRET }   // 不要省略
```

## Workers 上能看到什么

| 能力 | Node | Workers |
|---|---|---|
| `logo.*` 日志 | 完整 | 完整 |
| stdout sink | 写 stdout | 退化为 `console.log` |
| 文件 sink | 有 | 无（没有文件系统） |
| 飞书 sink | 有 | 有（走 fetch） |
| 控制台页面 / SSE | 有 | 有 |
| 命令执行 | 完整 | 完整 |
| 日志视图 | 全进程 | **仅当前 isolate** |
| CPU / 内存指标 | 真实读数 | 自维护计数器 |
| 历史日志 | 进程内环形缓冲 | 同左，isolate 重建即丢失 |
| 登录态 | 随进程重启失效 | 随 isolate 回收失效（配了固定 secret 后由 token 有效期兜底） |

## 为什么日志视图只有本 isolate

Node 里所有请求共享一个进程，日志进同一块环形缓冲。Workers 里每个 isolate 是独立实例，`/events` 这条 SSE 连接活在哪个 isolate，就只能看到那个 isolate 里产生的日志。

要跨 isolate 必须引入共享存储（Durable Object、KV、Queues 或外部日志收集器），那是另一个决定，本库不做。

**实践建议**：Workers 上把控制台当"抽查单个 isolate 的即时状态"用；需要全局视图时，用飞书 sink 或 Logpush 把日志导向外部。

## 为什么不做定时批量

`logo` 的批量刷新依赖定时器。Workers 的响应返回后，未触发的定时器可能被取消——批量反而会丢日志。库的做法是：检测不到可同步写的 stdout 时，日志逐条立即写出。这条规则同样适用于 Vercel Edge、Deno Deploy 这类环境。

## 已知的环境限制

- **不能用非字面量的 `import()`**：workerd 要求静态模块说明符。库内部已经没有任何动态 import（这条是 miniflare 集成测试抓出来的）。
- **CPU 时间有限**：控制台的命令走同一套执行路径，一个跑太久的命令会被 HTTP 超时（默认 10 秒）截断。
- **SSE 长连接**：Workers 的 HTTP 请求没有 wall time 上限，客户端连着就能一直推；但客户端断线后需要重连，前端已经带了指数退避。

## 验证过什么

`test/integration/workers.test.ts` 用 miniflare（真实的 workerd）跑过：页面渲染、公开命令、登录、`top` 返回 `runtime: "workers"`、SSE 鉴权与建流。不是"文档说可以"，是跑过的。
