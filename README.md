# Needle

Web Shell，支持命令查看当前系统状态，如进程状态、业务数据等。

零运行时依赖：只导入日志 1.8 KB，连 shell 25.4 KB（min+gzip，`bun run size` 可复现）。

三个包，按需要取用：

| 你要什么 | 从哪 import | 能跑在哪 |
|---|---|---|
| 通用数据结构：`SortedTable` | `@needle/core` | 任何地方 |
| 日志：`logo` / `newLogger` / `createLarkSink` / `formatTime` / `toHuman` | `@needle/logo` | 任何地方（含浏览器、Workers） |
| Shell：`createServerShell` / `createBrowserShell` / `mountShell` / `createFetchAdapter` | `@needle/shell` | 任何地方（含浏览器、Chrome 扩展） |
| 日志的 Node 专属能力：`createFileSink` / `createLogFiles` | `@needle/logo/node` | 仅 Node / Bun（`node:fs`） |
| Shell 的 Node 专属能力：`serve` / `attach` | `@needle/shell/node` | 仅 Node / Bun（`node:http`） |

`@needle/core` / `@needle/logo` / `@needle/shell` 的根入口都不 import 任何 `node:` 模块，所以浏览器和 Workers 打包时不会把 Node 代码带进来。依赖是单向的：`shell` → `logo`，`core` 不依赖任何包。

## 一、Shell

### 1. 登录（auth）

配了 `auth.users` 之后，命令要先 `auth <用户名>` 登录；**未登录只有 `auth` 和 `help` 可用**，`help` 也只列这两条。没配 `users` 时谁都登不进去；本地面板用 `user: "local"` 跳过鉴权（见浏览器那篇）：

账号在 `createServerShell({ auth: { users } })` 里配：用户名 → 口令，想开几个就写几项，登录时 `auth <用户名>`。

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
| `log.list` | 列出日志文件（Node 读磁盘，浏览器读 IndexedDB），点文件名取回全文；hover 文件名看末尾几行样本 |
| `top` | 打一份进程指标快照 |
| `sub` / `unsub` | 订阅 / 取消订阅主题，如 `sub top 2000` |

`log.list` 看的是历史：Node 侧读磁盘（要传 `logFiles`），浏览器侧读 IndexedDB（要传 `createIndexedDbStore()` 建的 store，见「浏览器纯前端页」篇）；右栏是实时日志，只在面板打开时存在，刷新即空。

### 3. 自定义命令

命令写在 `createServerShell({ commands: [...] })` 里，`run` 拿到的上下文是 `{ args, user, log }`，返回 `text` / `table` / `json` 三种形态之一。下面是装好三个命令的完整文件：

```ts
import { createLogFiles } from "@needle/logo/node";
import { createServerShell, table, type Command } from "@needle/shell";
import { serve } from "@needle/shell/node";

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

export const shell = createServerShell({
  basePath: "/shell",
  auth: {
    // 用户名 → 口令。想开几个账号就写几项，比如 { alice: "...", bob: "..." }
    users: { admin: process.env.SHELL_PASSWORD! },
    // 签 token 的密钥，不是口令；不传就每次启动随机生成
    secret: process.env.SHELL_SECRET!,
  },
  timeoutMs: 10_000,         // 命令超时，超了返回 timeout；默认 10 秒
  logFiles: createLogFiles({ dir: "logs" }),   // 不传的话 log.list 会报"没有配置日志目录"
  commands: [ping, routes, order],
  // 不传 logger 时，命令里的 log 就是 @needle/logo 的全局 logo 实例
});

const server = await serve(shell.handler, { port: 3000 });
//Shell: http://127.0.0.1:3000/shell
```

## 二、日志（logo）

### 1. 如何使用

`console.log` 只是把一行字符串丢给 stdout，它的问题是：

- **性能**：console.log 瞬间发送1000条，会卡死 IO。
- **去处**：stdout 走了就没了；想按级别分文件、想把 error 推到飞书，得自己接。

所以在日志进 stdout 之前加一层：一次调用变成一条结构化记录，再由你挂的 sink 决定它去哪。

```ts
import { logo } from "@needle/logo";

logo.info("order created", { orderId: 42 });
// 打印：2026-10-23T10:50:43 [I] {"orderId":42,"msg":"order created"}
// sink 收到：{"orderId":42,"time":1758991234567,"level":"info","msg":"order created"}

const err = new Error("card declined");
logo.error("paid failed", err, { userId: 7 });
// Error 展开成 message + stack
```

### 2. 分发到不同的 sink

```ts
import { createLarkSink } from "@needle/logo";
import { createFileSink } from "@needle/logo/node";

logo.addSink(createFileSink({ dir: "logs" }));                                       // 按级别分文件
logo.addSink(createLarkSink({ webhook: process.env.LARK_HOOK!, minLevel: "error" })); // error 推飞书
process.on("SIGTERM", () => logo.dispose());                                         // 退出前冲缓冲区
```

`info` 默认攒批 100ms 才写出去，`warn` / `error` 立即写出并把积压一起带出去。测试里断言 sink 收到的记录之前，先 `logo.flush()`。



## 三、平台支持

同一个库，能拿到什么取决于跑在哪：

| 平台 | Shell 形态 | 文件 sink | 细节 |
|---|---|---|---|
| 服务端 Node / Bun | HTTP + SSE | 有 | [node-server.md](docs/best-practices/node-server.md) |
| Cloudflare Workers | HTTP + SSE | 无 | [node-server.md 四、Cloudflare Workers](docs/best-practices/node-server.md#四cloudflare-workers) |
| Chrome 扩展 | DOM 面板 | 无 | [chrome-extension.md](docs/best-practices/chrome-extension.md) |
| 浏览器纯前端页 | DOM 面板 | 无 | [browser-client.md](docs/best-practices/browser-client.md) |

文件 sink 只在有 `node:fs` 的地方能用：`@needle/logo/node` 顶层 `import "node:fs"`，浏览器和 Workers 打包时不能碰它；`@needle/core`、`@needle/logo`、`@needle/shell` 三个根入口都不碰 `node:`（`@needle/core` 本来就没有 `node:` 依赖；logo / shell 由各自的 `browser-safety.test.ts` 对打包产物做内容断言）。



## 四、安装、测试与开发

### 1. 安装

还没发到 npm，所以走 `bun link`：先把三个包各注册一次，之后每个新项目一条命令。

```bash
# ── 1. 一次性：把仓库拉到本地，构建并注册三个包（以后拉新代码不用重新 link）──
git clone https://github.com/lixianmin/needle.git ~/needle
cd ~/needle && bun install && bun run build
cd ~/needle/packages/core && bun link        # 注册 @needle/core
cd ~/needle/packages/logo && bun link        # 注册 @needle/logo
cd ~/needle/packages/shell && bun link       # 注册 @needle/shell

# ── 2. 每个新项目：建目录并接上需要的包 ──
mkdir -p ~/my-service && cd ~/my-service
bun init -y
bun link @needle/logo @needle/shell          # 用到哪个就 link 哪个

# ── 3. 写入口：Shell 挂在 /shell，业务日志自动进右栏 ──
cat > server.ts <<'TS'
import { createServerShell } from "@needle/shell";
import { serve } from "@needle/shell/node";
import { logo } from "@needle/logo";

// 不传 logger 时用根入口的全局实例：业务里 logo.info(...) 都会出现在右栏
const shell = createServerShell({
  basePath: "/shell",                                         //Shell 路径；不写就挂在站点根目录
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
console.log(`Shell: http://127.0.0.1:${server.port}/shell`);
TS

# ── 4. 跑起来（前台运行，Ctrl+C 退出）──
bun server.ts

# ── 5. 服务跑着的时候，在浏览器里操作 ──
# 打开 http://127.0.0.1:3000/shell
# 输入 auth admin 回车 → 提示「密码:」后输入 admin 回车
# 输入 ping 回车：左栏回 pong，右栏「日志」出现「ping 被调用」
# 输入 help 回车：列出全部命令
```

`bun link` 只是在项目里写一条 `"@needle/logo": "link:@needle/logo"`（以及 shell 同款）指向 `~/needle/packages/*`，
拉取新代码后不用重新 link；只有把 `~/needle` 挪走或删掉时才需要重来一次。

一个包拆成三个之后，不能再靠 git 依赖装（`github:lixianmin/needle` 拿到的是私有根包，workspaces 的子包不在里面）。
多项目安装只有两条路：本地 `bun link`（上面这种），或等发布到 npm 后 `bun add @needle/logo @needle/shell`。


### 2. 测试

```bash
cd ~/needle                 # demo 在仓库里
bun run demo                # 先构建 @needle/logo，再起 demo（改 logo 源码后必须重建）
# 打开 http://127.0.0.1:1234/shell
# 使用 auth xmli 登录，密码 123456
# 使用 help 查看命令列表
```



### 3. 开发

```bash
cd ~/needle                 # 已经在 §四.1 克隆过
bun install
bun run build               # core → logo → UI 脚本 → shell；三份 dist 与内联 UI 脚本
bunx tsc --noEmit           # 类型检查
bun test                    # 全部用例

# `packages/*/dist/` 随源码一起提交：clone 下来直接 bun test / smoke 就能跑。
# 每次提交都会自动重建三份 dist 并 stage 进同一个 commit。
git config core.hooksPath .githooks

# 版本号只改根 `package.json`；`bun run version:sync` 负责写进三个包并刷新 bun.lock，
# pre-commit 会自动跑，`test/version-lock.test.ts` 在包或锁文件不一致时直接红。
```

跨包只走包名（`@needle/logo` 解析到 `dist`），所以**改了 logo 源码后先跑 `bun run build:logo`**，否则 shell 的测试与 demo 跑的是旧产物。`test/build-fresh.test.ts` 会在产物过期时直接报错。

