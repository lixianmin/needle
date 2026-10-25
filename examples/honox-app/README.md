# honox-app

`@needle/honox` 的示例：配置 + JWT 鉴权 + 请求日志（业务自写）+ Excel 模板表 + Shell 面板。路由直接挂在 `createHonox()` 返回的 Hono 实例上，不引入 npm 上的 `honox`（HonoX）——见“为什么不是 HonoX”。

## 依赖怎么来

`@needle/*` 三个包还没发 npm，这里用 `link:` 指向仓库里的 `packages/*`（`bun install` 会建立软链接，不需要 `bun link` 的全局注册）。本示例有**自己的** `node_modules`、`bun.lock` 和 `tsconfig.json`，不进仓库根 workspace：`bun install --frozen-lockfile` 与 Docker 构建要能独立复现。TypeScript 与根同版本（`7.0.2`，有测试钉住）。

```bash
bun install        # 装 hono / typescript 等
bun run dev        # 开发：bun --watch 直接跑 app/main.ts，改代码自动重启
bun run build      # bun build → dist/index.js（自包含产物）
bun run start      # 跑构建产物；端口取自 res/config，ENV 默认 dev
```

Shell 面板的账号在 `res/config/app_dev.yml` 的 `server.shell_users` 里（本仓库是 `xmli / 123456`，只用于本地）。
登录密钥是 `shell.secret`，与业务 JWT 的 `auth.secret` 分开（两边 token 都是 `sub`+`exp`，共用一个密钥等于把面板口令变成业务接口的通行证）。**必须显式配**：库在不给 secret 时会随机生成，那样每次重启已签发的 token 全废，浏览器里的登录态跟着丢。`app_pro.yml` 刻意不写，镜像里用 `APP_SHELL__SECRET` 注入。
登录态存 localStorage，有效期 7 天（`main.ts` 里 `SHELL_TOKEN_TTL_DAYS`）。

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

只有一种拿法：`import { viper } from "../viper"`，请求内请求外都直接 import。

配置是进程级单例，不进 request context——少一份可变的副本，也少一层「配置从哪来」的追问。`app/viper.ts` 只 `declare module "hono"` 补了 `uid` 一个键，那是请求级的东西。

```ts
viper.getInt("server.web_port")           // 8001
viper.getString("server.host", "0.0.0.0") // 缺省值给了就不抛
viper.getStringMap("server.shell_users")  // { xmli: "123456" }（YAML 数字转字符串）
viper.getBool("feature.on")
viper.has("server.host")                  // 路径上有值
viper.env / viper.isDev() / viper.isFat() / viper.isPro()
```

取值语义比 viper 严一点：缺值又没给 fallback 就抛，不会静默变成 `""` / `0`。`required` 里的点分路径在启动时检查，缺了或空字符串都直接报错（所以 `app_pro.yml` 刻意不写 `auth.secret`，生产必须用 `APP_AUTH__SECRET` 注入）。

`logger` 由 `app/logo.ts` 读：`filter_level` 定级别，`lark_url` 是飞书群机器人的 webhook 地址（**地址本身就是密钥**，仓库里留空，真实值用 `APP_LOGGER__LARK_URL` 注入）。`redis` 段当前示例不读，留着给业务扩展。

## 接口

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /` | 公开 | 测试台页面（见下节） |
| `POST /login` | 公开 | body `{"user":"alice","passcode":"<sha256hex(盐+密码)>"}`，返回 `{uid, token, expiresAt}`；token 是 `auth.secret` 签的真 JWT，口令不对 → 401 |
| `GET /health` | 公开 | `{"ok":true}` |
| `POST /bots/get_bots` | 需要 JWT | body `{"id":1}` 命中返回 `{ baseUrl, bot }`；空 body `{}` 返回 `{ baseUrl, bots }`（全表）；`id` 非数字 → 400，查不到 → 404 |
| `POST /bots/get_bot_name` | 需要 JWT | body `{"id":1}`，返回 `{ name }`；body 不合规 → 400，查不到 → 404 |
| `GET /shell` | 公开（面板自己用 `server.shell_users` 里的账号登录） | 调试面板 |

## 首页测试台

`bun run dev` 之后打开 <http://localhost:8001/>，根目录是一张测试页（`res/web/home.html`，单文件、零依赖、零构建）。它解决的是「接口都在 JWT 后面，没有 token 就只能看到 401」这件事：

1. 在右上角输用户名 + 密码（默认 `alice` / `alice123`），点**登录**：页面算 `sha256(盐+密码)` 当 passcode，`POST /login` 换回一枚真 token（HS256、uid 在 `sub`、1 小时过期），存进 localStorage；
2. 点左边的按钮打 `/bots/*` 的各个分支——200 / 400（`{"id":"abc"}` 与空 body）/ 404（`{"id":999}`）/ 401（故意不带 token 的对照组）；业务接口全是 POST，页面没有方法选择，只有健康检查固定 GET；
3. 右侧显示状态码、`x-rid`、耗时和格式化后的 JSON，底部是本次会话的历史。

登录会**真校验**：服务端按用户名查记录，用同一份盐比对 passcode。测试用户硬编码在 `app/api/login.ts`（`alice`/`alice123`、`bob`/`bob123`），用户名不存在与口令不对回同一个 401（否则就是个用户名枚举接口）。

**但它不是完整的安全方案**：盐是固定的、写在前端，不防重放、不防离线爆破，也没有限流和锁定。真实项目要每用户独立盐 + 一次性挑战（nonce / 短信验证码），服务端用同一份盐和那次挑战重算并当场作废。日志只记 `{user, uid}`，不记 passcode 也不记 token——`trace.json()` 会把响应体原样落盘，凭据不能这么走。

右上角**Shell 面板 ↗** 是另一个入口，用 `server.shell_users` 的账号密码登录，和这枚 JWT 是两套凭据。

不想开浏览器时，命令行同样一条命令拿 token：

```bash
# passcode = sha256hex("needle-demo-salt" + 密码)，与页面算的是同一个值
PASSCODE=$(bun -e 'const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("needle-demo-saltalice123")); console.log([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""))')
curl -s -X POST "http://127.0.0.1:8001/login" \
  -H 'content-type: application/json' -d "{\"user\":\"alice\",\"passcode\":\"$PASSCODE\"}" \
  | bun -e 'const j = await Bun.stdin.json(); console.log(j.token)'
```

## 接口目录

每个 HTTP 接口一个文件，全在 `app/api/`；`app/api/index.ts` 只做挂载，`app/main.ts` 只装配中间件。

```
app/api/
  index.ts       # registerApis(app)：逐个 app.route("/", xxx)
  home.ts        # GET /（测试台页面，JWT 白名单）
  login.ts       # POST /login（用户名 + passcode 换 JWT，白名单）
  health.ts      # GET /health（JWT 白名单，匿名可访问）
  bots.ts        # 一个路由组：POST /bots/get_bots + POST /bots/get_bot_name
app/viper.ts     # 配置实例（viper 风格取值器）+ c.get 的键声明
res/web/home.html # 测试台页面本体（随 res/ 进镜像，启动时读一次）
```

文件数量不是目的：一个领域一个文件就够了，同文件里挂多条路由（`botsApi.post`）。要覆盖更多情况就加路由，不要一个新接口开一个新文件。

新增接口：在 `app/api/` 加一个文件，建一个组，把该领域的所有路由挂上去，再到 `index.ts` 里 `app.route("/", xxxApi)`。`app/main.ts` 不用动。

```ts
// app/api/bots.ts —— 一个文件一个组，可以挂多条路由
import { createApi } from "@needle/honox";
import { BotNameBody, BotsBody } from "../beans/bots.js";

export const botsApi = createApi("api/bots");   // 参数是日志里的模块名，必填

botsApi.post("/bots/get_bots", BotsBody, (ctx, request) => { ... });          // POST/PUT/PATCH：解析 body
botsApi.post("/bots/get_bot_name", BotNameBody, (ctx, request) => { ... });  // POST/PUT/PATCH：解析 body
botsApi.get("/health", (ctx) => ctx.json({ ok: true }));       // 不校验参数
```

`createApi(module)` 返回的是真正的 `Hono`，所以 `app.route("/", botsApi)` 照常挂。`module` 会写进 context，业务日志的**行前缀**因此是 `api/bots`——打包、压缩后 `文件:行` 会变成 bundle 坐标，这个字符串才是生产环境唯一还活着的定位信息（不再重复写进 JSON）。

参数模型见 `app/beans/`：手写 class（`bots.ts`、`login.ts`），`scripts/gen-models.ts` 生成 TypeBox schema（`bots.generated.ts`，提交进仓库）。bean 文件顶部 `import "./bots.generated.js"`，所以业务 import 这个 bean 文件时 schema 就注册好了，不需要额外的 barrel。生成物带漂移断言，class 改了没重新生成会编译报错。

handler 的参数不用写类型注解：`botsApi.post("/bots/get_bot_name", BotNameBody, (ctx, request) => …)` 已经推断出 `ctx: Context<HonoxEnv>` 和 `request: BotNameBody`，再写一遍就是同一信息写两次。

**模型类名在压缩后必须还在**：注册表按 `class.name` 查 schema，`bun build --minify` 会把类名抹平（和下面 Excel sheet 名同一个坑）。线上要用压缩构建就给生成物传显式名字，或者别压缩 bean 文件。

已经有 `new Hono()` 实例时，用 `apiRoute("api/apc", handler)` 单独包 handler。

**rid 是 ULID**：入站带 `x-rid`（或 `x-request-id`）就沿用，没带才由 `@needle/got` 的 `nextUlid()` 生成。128 位 = 48 位绝对毫秒 + 80 位随机，对外是**定长 26 位大写 Crockford Base32 字符串**（`0-9A-Z` 去掉 `I L O U`）。不需要配纪元、也不需要配机器号：多实例、多进程、容器重建都不会重号，这是 rid 选 ULID 而不是 Snowflake 的原因（Snowflake 的机器号只有 10 位）。定长保证字典序 = 时间序；同一毫秒内不保证递增（随机段是乱的），rid 不需要。

业务实体 id 要紧凑、严格递增时用 `@needle/got` 的 `nextSnowflakeId({ nodeId })`：13 位小写 Crockford Base32，`41 毫秒 | 10 机器号 | 12 序列`，多实例必须传不同 `nodeId`。

**uid 是自动的，请求日志不是**：`createHonox()` 装配的中间件链是 `rid → 兜底日志 → JWT 鉴权`，所有 `app/api/` 里的路由都挂在它后面。于是每条请求：

- 由 JWT 中间件写入 `ctx.get("uid")`（没带 token 就是 `null`，受保护路由直接被 401 短路）；
- **不写请求日志**。打不打、打什么由业务决定：

```ts
import { traceOf } from "@needle/honox";

botsApi.post("/bots/get_bot_name", BotNameBody, (ctx, request) => {
  // 一行：建 trace + 打第一条日志（四个级别方法都返回 trace 自己）
  const trace = traceOf(ctx).info(request);
  ...
  // 出口：记一行 info（status + result），然后把响应返回
  return trace.json({ name: bot.name });
});
```

```
2026-10-25T11:20:03 [I] api/bots {"rid":"01M5Q4VBM312ET9MKN9RRYB40N","uid":"u1","path":"/bots/get_bot_name","id":1}
```

（`api/bots` 是 `createApi(module)` 手写的模块名，只出现一次，在前缀里；JSON 里只留 `rid` / `uid` / `path` 和业务字段。日志不再抓注册位置，所以同一路由的多条日志不会再共享同一个误导性的 `文件:行`。）

库只补业务补不了的四种：401（门禁）、404（未命中）、500（含未捕获异常）、慢请求（默认 >1000ms）。`/health` 这种不写日志的接口就是零日志。

query 的约定（写死的行为）：重复键在数组 schema 下收齐全部值、否则取最后一个；空串 `?id=` 视为未传；只认 schema 声明过的键，多余的忽略。**数组要用重复键**（`?ids=1&ids=2`），`?ids[]=1` 这种带方括号的写法不认。

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
