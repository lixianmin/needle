# Needle

Web Shell 控制台，支持命令查看当前系统状态，如进程状态、业务数据等。

零运行时依赖：只导入日志 1.8 KB，连 shell 23.7 KB（min+gzip，`bun run size` 可复现）。

一个包 `@needle/needle`，三个入口，按环境取用：

| 你要什么 | 从哪 import | 能跑在哪 |
|---|---|---|
| 日志：`logo` / `newLogger` / `createLarkSink` / `formatTime` / `toHuman` | `@needle/needle` | 任何地方（含浏览器、Workers） |
| 控制台：`createShell` / `createBrowserShell` / `mountShell` / `createFetchAdapter` | `@needle/needle/shell` | 任何地方（含浏览器、Chrome 扩展） |
| Node 专属：`createFileSink` / `createLogFiles` / `serve` / `attach` | `@needle/needle/node` | 仅 Node / Bun（`node:fs`、`node:http`） |

根入口与 `./shell` 都不 import 任何 `node:` 模块，所以浏览器和 Workers 打包时不会把 Node 代码带进来。

## 一、控制台（shell）

### 1. 登录（auth）

配了 `auth.users` 之后，命令要先 `auth <用户名>` 登录；**未登录只有 `auth` 和 `help` 可用**，`help` 也只列这两条（没配 users 时是匿名放开的）：

账号在 `createShell({ auth: { users } })` 里配：用户名 → 口令，想开几个就写几项，登录时 `auth <用户名>`。

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

`log.list` 读的是磁盘文件（Node 侧要传 `logFiles`），看的是历史；右栏是实时日志，只在 shell 打开时存在，刷新即空。

### 3. 自定义命令

命令写在 `createShell({ commands: [...] })` 里，`run` 拿到的上下文是 `{ args, user, log }`，返回 `text` / `table` / `json` 三种形态之一。下面是装好三个命令的完整文件：

```ts
import { createLogFiles } from "@needle/needle/node";
import { createShell, table, type Command } from "@needle/needle/shell";
import { serve } from "@needle/needle/node";

// 命令在进程内执行，直接读它就行，不用先把状态打进日志
const orders = new Map<string, Record<string, unknown>>();

// 1. 纯文本：返回一段字符串
const ping: Command = {
  name: "ping",              // help 里显示的名字
  note: "确认 shell 还活着",  // help 里显示的说明
  run: () => ({ kind: "text", text: `pong ${new Date().toISOString()}` }),
};

// 2. 表格：列在这里定义一次，之后一行一个对象
const routesTable = table<{
  path: string;
  reads: number;
  bytes: number;
  latencyMs: number;
  // 单元格可以是 string | number | null | { text, href }
  // 这里演示后两种：null 渲染成空格子，{ text, href } 渲染成链接
  file: { text: string; href: string } | null;
}>({
  path: { format: "auto" },                     // auto：默认值，整数且 ≥1024 时按 K/M 缩
  reads: { format: "number" },                  // number：原样显示，1520 还是 1520
  bytes: { format: "bytes", title: "traffic" }, // bytes：3_600_000 → 3.43M；title 换表头文字
  latencyMs: { format: "duration" },            // duration：当毫秒，57_720 → 57.7s
  file: {},                                     // 不写 title 就用字段名当表头
});

const routes: Command = {
  name: "routes",
  note: "按接口看流量",
  // 列顺序 = 上面 schema 的书写顺序；点表头按原始数值排序，不是按显示出来的字符串
  run: () =>
    routesTable.output([
      {
        path: "/api/user",
        reads: 1520,
        bytes: 3_600_000,
        latencyMs: 57_720,
        file: { text: "info.log", href: "/shell/log/info.log" },
      },
      { path: "/health", reads: 12, bytes: 512, latencyMs: 3, file: null },
    ]),
};

// 3. JSON：任意可序列化的值，适合嵌套结构，或要贴给别人的结果
const order: Command = {
  name: "order",
  note: "按 id 看订单",
  args: "<id>",              // 只影响 help 里的用法提示；真实参数在 run 的 args 里
  run: async ({ args, user, log }) => {
    // args 按空白切开、不解析引号：`order 42` → ["42"]
    // user 是跑这条命令的人；未登录时只有 help 能跑，那时它是 null
    log.info("查看订单", { id: args[0], user });   // 写进业务日志；shell 开着时也会出现在右栏的日志 tab

    const found = orders.get(args[0]!);
    if (found === undefined) throw new Error(`没有订单 ${args[0]}`);   // 抛错会作为命令失败回显
    return { kind: "json", value: found };
  },
};

export const shell = createShell({
  basePath: "/shell",
  auth: {
    // 用户名 → 口令。想开几个账号就写几项，比如 { alice: "...", bob: "..." }
    users: { admin: process.env.CONSOLE_PASSWORD! },
    // 签 token 的密钥，不是口令；不传就每次启动随机生成
    secret: process.env.CONSOLE_SECRET!,
  },
  timeoutMs: 10_000,         // 命令超时，超了返回 timeout；默认 10 秒
  logFiles: createLogFiles({ dir: "logs" }),   // 不传的话 log.list 会报"没有配置日志目录"
  commands: [ping, routes, order],
  // 不传 logger 时，命令里的 log 就是根入口的全局 logo 实例
});

const server = await serve(shell.handler, { port: 3000 });
// 控制台: http://127.0.0.1:3000/shell
```

## 二、日志（logo）

### 1. 如何使用

`console.log` 只是把一行字符串丢给 stdout，它的问题是：

- **性能**：console.log 瞬间发送1000条，会卡死 IO。
- **去处**：stdout 走了就没了；想按级别分文件、想把 error 推到飞书，得自己接。

所以在日志进 stdout 之前加一层：一次调用变成一条结构化记录，再由你挂的 sink 决定它去哪。

```ts
import { logo } from "@needle/needle";

logo.info("order created", { orderId: 42 });
// 打印：2026-10-23T10:50:43 [I] {"orderId":42,"msg":"order created"}
// sink 收到：{"orderId":42,"time":1758991234567,"level":"info","msg":"order created"}

const err = new Error("card declined");
logo.error("paid failed", err, { userId: 7 });
// Error 展开成 message + stack
```

### 2. 分发到不同的 sink

```ts
import { createLarkSink } from "@needle/needle";
import { createFileSink } from "@needle/needle/node";

logo.addSink(createFileSink({ dir: "logs" }));                                       // 按级别分文件
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!, minLevel: "error" })); // error 推飞书
process.on("SIGTERM", () => logo.dispose());                                         // 退出前冲缓冲区
```

### 3. 常见坑

以下都在 0.2.34 的 dist 上实测过，按「现象 → 怎么办」写。

- **记录里没有 `message`，字段叫 `msg`。** 只有传 `Error` 时才会出现 `message`（展开成 `message` + `stack`）；普通日志判正文用 `msg`。
- **`time` / `level` 不在打印出来的 JSON 里。** 落盘行是 `2026-10-23T10:50:43 [I] {…}`：时间与级别只在前缀；记录的 `time` 是 **epoch 毫秒数字**。时间固定 `+08:00`，与机器 `TZ` 无关。
- **默认只有 `error` 带 `stack`。** `stackLevel` 默认 `"error"`（0.2.2x 起；更早版本是 `"warn"`）：`warn` 记录没有 stack，要就给 `newLogger({ stackLevel: "warn" })`。传 `Error` 时用的是 Error 自己的栈（抛出点）。
- **`info` 默认攒批（100ms）。** 测试里断言 sink 之前先 `flush()`；`warn` / `error` 立即写出并把积压一起带出去。`batch: false`（Workers 默认）时每条立即写，没有定时器兜底。
- **Node 里 spy `console.log` 抓不到日志。** 有 `process.stdout.write` 时 stdout sink 直接写 stdout。要断言就 `addSink` 自己的函数。
- **`logo` 没有 `name`。** 记录里就没有 `name` 字段；`newLogger({ name })` 与 `child({ name })` 才有。想按来源过滤就自己加业务字段。
- **信封字段会被丢弃。** `info("x", { level: "error", time: 1, msg: "fake", name: "y" })` 记成 `{level:"info", msg:"x", time:<now>}`——业务对象伪造不了 `time` / `level` / `msg` / `name`。
- **非纯对象进 `msg`，不进字段。** 数组、`Date`、`Map`、类实例都会序列化后拼进 `msg`；要可查询的字段就传纯对象。
- **`child()` 会快照 sink。** 建 child 之后再给父级 `addSink`，子实例收不到。要统一落点就在启动早期建 child，或直接给 child 挂。
- **`dispose()` 之后日志静默丢弃。** 父级 dispose 连子级一起停（共用状态）；退出前调一次即可，别在长生命周期进程里早调。
- **`./node` 不能进浏览器 / Workers 打包。** 它专放 `node:` 能力（文件 sink、日志目录、HTTP 服务），根入口 `.` 与 `./shell` 不碰 `node:`。
- **git 依赖不会自己跟 main。** lockfile 钉住 sha 后 `bun install` 不会动，升级要 `bun update @needle/needle`。两方 spec 不同但解析到同一 sha 时只装一份（bun 按解析结果去重）；不同 sha 才是两份副本——那时 `logo` 会变成两个对象，各自的 sink 互不可见。



## 三、平台支持

同一个库，能拿到什么取决于跑在哪：

| 平台 | 控制台形态 | 文件 sink | 细节 |
|---|---|---|---|
| 服务端 Node / Bun | HTTP + SSE | 有 | [server.md](docs/best-practices/server.md) |
| Cloudflare Workers | HTTP + SSE | 无 | [workers.md](docs/deploy/workers.md) |
| Chrome 扩展（MV3） | DOM 面板 | 无 | [chrome-extension.md](docs/best-practices/chrome-extension.md) |
| 浏览器纯前端页 | DOM 面板 | 无 | [browser-client.md](docs/best-practices/browser-client.md) |

文件 sink 只在有 `node:fs` 的地方能用：`@needle/needle/node` 顶层 `import "node:fs"`，浏览器和 Workers 打包时不能碰它；`.` 与 `./shell` 两个入口是干净的（`test/unit/browser-safety.test.ts` 对打包产物做内容断言）。



## 四、安装、测试与开发

### 1. 安装

还没发到 npm，所以走 `bun link`：**仓库只注册一次，之后每个新项目一条命令**。

```bash
# ── 1. 一次性：把仓库拉到本地，注册这个包（以后拉新代码不用再跑）──
git clone https://github.com/lixianmin/needle.git ~/needle
cd ~/needle && bun install && bun link     # 注册 @needle/needle

# ── 2. 每个新项目：建目录并接上这个包 ──
mkdir -p ~/my-service && cd ~/my-service
bun init -y
bun link @needle/needle

# ── 3. 写入口：控制台挂在 /shell，业务日志自动进右栏 ──
cat > server.ts <<'TS'
import { createShell } from "@needle/needle/shell";
import { serve } from "@needle/needle/node";
import { logo } from "@needle/needle";

// 不传 logger 时用根入口的全局实例：业务里 logo.info(...) 都会出现在右栏
const shell = createShell({
  basePath: "/shell",                                         // 控制台路径；不写就挂在站点根目录
  auth: { users: { admin: "admin" }, secret: "change-me" },    // 用户名→口令；secret 是签 token 的密钥
  commands: [
    {
      name: "ping",
      note: "回一句 pong，并写一条日志",
      run: () => {
        logo.info("ping 被调用");                               // 会出现在右栏「日志」里
        return { kind: "text", text: "pong" };
      },
    },
  ],
});

const server = await serve(shell.handler, { port: 3000 });
console.log(`控制台: http://127.0.0.1:${server.port}/shell`);
TS

# ── 4. 跑起来（前台运行，Ctrl+C 退出）──
bun server.ts

# ── 5. 服务跑着的时候，在浏览器里操作 ──
# 打开 http://127.0.0.1:3000/shell
# 输入 auth admin 回车 → 提示「密码:」后输入 admin 回车
# 输入 ping 回车：左栏回 pong，右栏「日志」出现「ping 被调用」
# 输入 help 回车：列出全部命令
```

`bun link` 只是在项目里写一条 `"@needle/needle": "link:@needle/needle"` 指向 `~/needle`，
拉取新代码后不用重新 link；只有把 `~/needle` 挪走或删掉时才需要重来一次。


### 2. 测试

```bash
cd ~/needle                 # demo 在仓库里
# 打开 http://127.0.0.1:1234/shell
# 使用 auth xmli 登录，密码 123456
# 使用 help 查看命令列表
bun examples/demo.ts
```



### 3. 开发

```bash
cd ~/needle                 # 已经在 §四.1 克隆过
bun install
bun test                    # 全部用例
bunx tsc --noEmit           # 类型检查

# `dist/` 随源码一起提交，这样 git 依赖不需要构建步骤就能用。
# 每次提交都会自动重建 `dist/` 并 stage 进同一个 commit。
git config core.hooksPath .githooks
```

