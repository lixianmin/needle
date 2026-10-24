# honox-app

`@needle/honox` 的示例：配置 + JWT 鉴权 + 每请求日志 + Excel 模板表 + Shell 面板。路由直接挂在 `createHonox()` 返回的 Hono 实例上，不引入 npm 上的 `honox`（HonoX）——见“为什么不是 HonoX”。

## 依赖怎么来

`@needle/*` 三个包还没发 npm，这里用 `link:` 指向仓库里的 `packages/*`（`bun install` 会建立软链接，不需要 `bun link` 的全局注册）。本示例有**自己的** `node_modules`、`bun.lock` 和 `tsconfig.json`，不进仓库根 workspace：`bun install --frozen-lockfile` 与 Docker 构建要能独立复现。TypeScript 与根同版本（`7.0.2`，有测试钉住）。

```bash
bun install        # 装 hono / typescript 等
bun run dev        # 开发：bun --watch 直接跑 app/main.ts，改代码自动重启
bun run build      # bun build → dist/index.js（自包含产物）
bun run start      # 跑构建产物；端口取自 res/config，ENV 默认 dev
```

Shell 面板的账号在 `res/config/app_dev.yml` 的 `server.shell_users` 里（本仓库是 `xmli / 123456`，只用于本地）。

## 相对导入一律带 `.js`

`import { viper } from "../viper.js"`、`import { registerApis } from "./api/index.js"`：
本示例虽然用 `moduleResolution: bundler`（扩展名可省），但各包是 `nodenext`（tsc 不改写说明符、Node ESM 也不解析无扩展名与目录导入），仓库统一成 `.js` 这一种写法，避免"在这里能跑、搬过去就报 ERR_MODULE_NOT_FOUND"。

## 为什么不是 HonoX

`@needle/honox` 和 npm 上的 `honox`（HonoX）只是名字撞了：前者是本仓库的 Hono 底座（配置/鉴权/日志/Excel/Shell），后者是文件路由 + islands 的元框架。底座返回的就是 `Hono` 实例，这几个接口直接 `.get()` 挂上去，用不上文件路由。

早期示例确实接过 HonoX（`createApp({ app: createHonox(...) })`），那条接法在 spec §7 的 spike 里验过并留档，业务侧要文件路由/islands 时照抄即可。不默认带上的原因：HonoX 的岛检测走 `precinct` → `@typescript-eslint/typescript-estree`，在 TypeScript 7 上直接抛 `TypeError: ... reading 'Cjs'`，会把整个示例钉死在 TS 5.9.3；而且依赖表里会出现两个 `honox`，每次读都要解释一遍。

## 配置

配置和模板表都在 `res/` 下，与镜像里的目录结构一致。加载顺序照 rim.server：

1. `res/config/common.yml`（所有环境共享，可缺）
2. `res/config/app_<env>.yml`（只写差异项，**必须存在**）
3. `APP_*` 环境变量（`__` 分隔层级，如 `APP_SERVER__WEB_PORT=9000`）

`ENV` 决定第 2 步加载哪个文件，只认 **dev / fat / pro**（默认 dev，写错直接报错）。这是整个示例里唯一读 `process.env` 的地方——**业务代码一律用 `viper.getXxx("点分路径")`**，不再自己去看环境变量。

配置实例在 `app/viper.ts` 里加载并导出，全进程只有一份：

```ts
// app/viper.ts
export const viper = loadConfig({ dir: "res/config", required: ["auth.secret", "metadata.base_url", "server.web_port"] });
```

两处拿法，拿到的是同一个实例：

- **请求外**（`app/main.ts`、`app/md/*`、服务层）：`import { viper } from "../viper"`。
- **请求内**（`app/api/*.ts`）：`c.get("config")`。键的类型在 `app/viper.ts` 里用 `declare module "hono" { interface ContextVariableMap { ... } }` 声明一次，所以接口文件写 `new Hono()` 就够了，不用 import 任何 env 类型。

```ts
viper.getInt("server.web_port")           // 8001
viper.getString("server.host", "0.0.0.0") // 缺省值给了就不抛
viper.getStringMap("server.shell_users")  // { xmli: "123456" }（YAML 数字转字符串）
viper.getBool("feature.on")
viper.has("server.host")                  // 路径上有值
viper.env / viper.isDev() / viper.isFat() / viper.isPro()
```

取值语义比 viper 严一点：缺值又没给 fallback 就抛，不会静默变成 `""` / `0`。`required` 里的点分路径在启动时检查，缺了或空字符串都直接报错（所以 `app_pro.yml` 刻意不写 `auth.secret`，生产必须用 `APP_AUTH__SECRET` 注入）。

`logger` / `redis` 几段当前示例不读（`@needle/logo` 的 lark sink 没接线），留着给业务扩展；`lark_token` 在仓库里是空字符串，真实值用 `APP_LOGGER__LARK_TOKEN` 注入。

## 接口

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /health` | 公开 | `{"ok":true}` |
| `GET /bots?id=1` | 需要 JWT | 命中返回 `{ baseUrl, bot }`；不带 `id` 返回 `{ baseUrl, bots }`（全表）；`id` 非数字 → 400，查不到 → 404 |
| `POST /bots` | 需要 JWT | body `{"ids":[1,99]}`，命中放 `bots`、找不到放 `missing`（批量里部分不存在不算失败）；body 不合规 → 400 |
| `GET /shell` | 公开（面板自己用 `server.shell_users` 里的账号登录） | 调试面板 |

生成一个测试 token：

```bash
bun -e 'import { sign } from "hono/jwt"; console.log(await sign({ sub: "u1", exp: Math.floor(Date.now()/1000)+3600 }, "dev-secret-change-me", "HS256"))'
```

## 接口目录

每个 HTTP 接口一个文件，全在 `app/api/`；`app/api/index.ts` 只做挂载，`app/main.ts` 只装配中间件。

```
app/api/
  index.ts       # registerApis(app)：逐个 app.route("/", xxx)
  health.ts      # GET /health（JWT 白名单，匿名可访问）
  bots.ts        # 一个路由组：GET /bots?id= + POST /bots
app/viper.ts     # 配置实例（viper 风格取值器）+ c.get 的键声明
```

文件数量不是目的：一个领域一个文件就够了，同文件里挂多条路由（`botsApi.get` / `.post`）。要覆盖更多情况就加路由，不要一个新接口开一个新文件。

新增接口：在 `app/api/` 加一个文件，建一个组，把该领域的所有路由挂上去，再到 `index.ts` 里 `app.route("/", xxxApi)`。`app/main.ts` 不用动。

```ts
// app/api/bots.ts —— 一个文件一个组，可以挂多条路由
import { createApi } from "@needle/honox";

export const botsApi = createApi();

botsApi.get("/bots", (c) => { ... });
botsApi.post("/bots", (c) => { ... });
```

`createApi()` 返回的是真正的 `Hono`，所以 `app.route("/", botsApi)` 照常挂。它比 `new Hono()` 多做的唯一一件事：**每次登记路由都自动抓下「文件:行」**写进 context，请求日志结束行因此指到 `bots.ts:9` 而不是中间件那一行。

已经有 `new Hono()` 实例、只想补位置时，用 `apiRoute(handler)` 单独包 handler。

**rid 是 Snowflake**：入站带 `x-rid`（或 `x-request-id`）就沿用，没带才生成。位布局 `41 毫秒 | 10 机器号 | 12 序列`，epoch 取配置里的 `server.epoch_ms`（写死，不能用启动时间），机器号由 `nodeIdFromMac()` 从网卡 MAC 派生。id 对外是**定长 13 位小写 Crockford Base32 字符串**（`0-9a-z` 去掉 `i l o u`）：63 位装不进 JS number，而 `JSON.stringify(bigint)` 会抛，所以从生成那刻就是字符串——写日志、进 JSON、存 Mongo/MySQL 都不用转换。定长保证字典序 = 数值序（变长会让新 id 排到旧 id 前面，B 树回头插）。

**uid 与请求日志是自动的**：`createHonox()` 装配的中间件链是 `rid → 请求日志 → JWT 鉴权`，所有 `app/api/` 里的路由都挂在它后面。于是每条请求都会：

- 由 JWT 中间件写入 `c.get("uid")`（没带 token 就是 `null`，受保护路由直接被 401 短路）；
- 打两行日志，进 `-->`、出 `<--`，结束行带 `status`、`durationMs`、`uid`、`req`：

```
[I] middleware.ts:71 [requestLog()] {"rid":"02zcgfqmyyw00","path":"/me"}
[I] me.ts:7 {"rid":"02zcgfqmyyw00","path":"/me","status":200,"durationMs":1.9,"uid":"u1"}
```

日志走 `@needle/logo` 的批处理，进程被杀前可能还没刷出来——本地验证时给它 1~2 秒。

## Excel 元数据

启动时扫 `res/metadata/`（路径来自配置的 `metadata.base_url`），按 **sheet 名后缀**分派。**代码里不写文件名，也没有注册清单**：

| 后缀 | 类型 | 语义 |
|---|---|---|
| `XxxTemplate` | Template | 按 id 取单条；第一层 key 就是 sheet 名 |
| `XxxConfig` | Config | 全局一份，取第一个非空数据行 |
| 其它 | — | 不是元数据表，跳过（启动日志会列出来） |

```
app/md/
  index.ts                 # createMetadata() + initTemplates(dir)
  bot-template.ts          # class BotTemplate  → getBotTemplate(id) / getBotTemplates()
  apc-template.ts          # class ApcTemplate  → getApcTemplate(id) / getApcTemplates()
  select-apc-config.ts     # class SelectApcConfig → getSelectApcConfig()
```

**类就是 schema**：字段默认值决定类型，默认值写 `[]` 的字段表示该列按 `|` 拆成数组；sheet 名默认取类名（所以类名要和 sheet 名一致）。

**每个文件只暴露三个东西**：类（类型）、`getXxx(id)`（单条）、`getXxxs()`（全表；Config 只有 `getXxx()`，它本来就只有一份）。句柄是文件内私有的 `const templates`，外面不需要也不应该碰。

现有三张 sheet：

| 文件 | sheet | 类型 | 列 |
|---|---|---|---|
| `BotTemplate.xlsx` | `BotTemplate` | Template | `id`、`name`、`prompt` |
| `ApcTemplate.xlsx` | `ApcTemplate` | Template | `id`、`equips`、`gender`、`name`、`buy_money`、`buy_price` |
| `ApcTemplate.xlsx` | `SelectApcConfig` | Config | `select_apc1`..`select_apc4` |

**新增一张表 = 在 `app/md/` 加一个文件**（需要对外就再加一个 `app.get`）；`index.ts` 和 `app/main.ts` 的模板相关代码都不用动。启动时 `await initTemplates(config.metadata.base_url)` 一次读完，之后 `getBotTemplate(id)` / `getSelectApcConfig()` 同步、零 IO。表直接用 Excel 维护，没有生成脚本。

`equips` 在 Excel 里是 `503048|508012|0|0|…`，因为类里写的是 `equips: string[] = []`，库里直接拆成数组（`"0"` 表示该槽位没装备，保留；元素会 trim；空单元格给 `[]`）。`SelectApcConfig` 的四个字段同理。业务侧拿到就是数组，不用自己 `split("|")`。

分隔符默认 `|`，逐列换用静态字段：

```ts
export class BotTemplate {
  static separators = { tags: "," };
  id = 0;
  tags: string[] = [];
}
```

注意：sheet 名取类名，所以构建产物**不要开 `--minify`**（压缩会把类名抹掉）。真需要压缩时显式补名字：`metadata.template(BotTemplate, "BotTemplate")`。

规则：首行表头（小写 + trim）。Template 每行必须有数字 `id`，缺 id / 非数字 / 重复都会在加载时报错并带 `文件#sheet` 和行号；Config 取第一个非空数据行，一行都没有也报错。同名 sheet 不能出现在两个文件里。`metadata.base_url` 目前只支持本地目录——`app_fat.yml` 里那个 https 地址是 rim.server 的远端元数据用法，本库还没做远端拉取。

## Docker

构建上下文必须是仓库根，因为要把 `packages/` 一起带进去：

```bash
docker build -f examples/honox-app/Dockerfile -t honox-app .
docker run --rm -p 8001:8001 \
  -e APP_AUTH__SECRET="换成你自己的随机串" \
  honox-app
```

镜像里 `ENV=pro`，读 `res/config/app_pro.yml`。那份配置刻意没写 `auth.secret`，所以不传 `APP_AUTH__SECRET` 就启动报错，不会带着仓库里的 dev 密钥裸奔。Shell 面板要开就在 `server.shell_users` 里配账号（pro 的配置里没有，所以镜像默认不挂面板）；`/shell` 在 JWT 白名单里，对它唯一的门就是这些账号。镜像不带 `node_modules`：`dist/index.js` 是自包含产物；`res/` 是运行时 fs 读的，整目录拷进镜像。
