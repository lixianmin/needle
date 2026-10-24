# honox-app

`@needle/honox` 的示例：配置 + JWT 鉴权 + 每请求日志 + Excel 模板表 + Shell 面板。路由直接挂在 `createHonox()` 返回的 Hono 实例上，不引入 npm 上的 `honox`（HonoX）——见“为什么不是 HonoX”。

## 依赖怎么来

`@needle/*` 三个包还没发 npm，这里用 `link:` 指向仓库里的 `packages/*`（`bun install` 会建立软链接，不需要 `bun link` 的全局注册）。本示例有**自己的** `node_modules`、`bun.lock` 和 `tsconfig.json`，不进仓库根 workspace：`bun install --frozen-lockfile` 与 Docker 构建要能独立复现。TypeScript 与根同版本（`7.0.2`，有测试钉住）。

```bash
bun install     # 装 hono / typescript 等
bun run build   # bun build → dist/index.js（自包含产物）
SHELL_PASSWORD=dev bun run start   # 默认 8213 端口（res/config/common.yml），PORT 可改
```

## 为什么不是 HonoX

`@needle/honox` 和 npm 上的 `honox`（HonoX）只是名字撞了：前者是本仓库的 Hono 底座（配置/鉴权/日志/Excel/Shell），后者是文件路由 + islands 的元框架。底座返回的就是 `Hono` 实例，这几个接口直接 `.get()` 挂上去，用不上文件路由。

早期示例确实接过 HonoX（`createApp({ app: createHonox(...) })`），那条接法在 spec §7 的 spike 里验过并留档，业务侧要文件路由/islands 时照抄即可。不默认带上的原因：HonoX 的岛检测走 `precinct` → `@typescript-eslint/typescript-estree`，在 TypeScript 7 上直接抛 `TypeError: ... reading 'Cjs'`，会把整个示例钉死在 TS 5.9.3；而且依赖表里会出现两个 `honox`，每次读都要解释一遍。

## 配置

配置和模板表都在 `res/` 下，与镜像里的目录结构一致：

- `res/config/common.yml`：所有环境共享（端口、host、redis）。
- `res/config/app_<env>.yml`：只写差异项，`ENV` 决定加载哪个（默认 `dev`）。
- 环境变量覆盖：`APP_AUTH__SECRET=xxx`（`__` 分隔层级），优先级最高；`PORT` / `HOST` 直接盖 端口/host。

`loadConfig({ dir: "res/config" })` 读的就是这个目录。启动时缺 `auth.secret` 会直接报错，不会带着空密钥跑。`logger` / `metadata` / `redis` 几段当前示例不读（`@needle/logo` 的 lark sink 没接线，模板路径写死在 `app/md/`），留着给业务扩展；`lark_token` 在仓库里是空字符串，真实值用环境变量注入。

## 接口

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /health` | 公开 | `{"ok":true}` |
| `GET /me` | 需要 JWT | 返回 `{ uid }`（取自 token 的 `sub`） |
| `GET /bots/:id` | 需要 JWT | 读 `BotTemplate` 表的那一行 |
| `GET /apc/:id` | 需要 JWT | 读 `ApcTemplate` 表的那一行 |
| `GET /select-apc` | 需要 JWT | 返回 `SelectApcConfig` 这份全局配置 |
| `GET /shell` | 公开（面板自己用 `SHELL_PASSWORD` 登录） | 调试面板 |

生成一个测试 token：

```bash
bun -e 'import { sign } from "hono/jwt"; console.log(await sign({ sub: "u1", exp: Math.floor(Date.now()/1000)+3600 }, "dev-secret-change-me", "HS256"))'
```

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

**新增一张表 = 在 `app/md/` 加一个文件**（需要对外就再加一个 `app.get`）；`index.ts` 和 `server.ts` 的模板相关代码都不用动。启动时 `await initTemplates(config.metadata.base_url)` 一次读完，之后 `getBotTemplate(id)` / `getSelectApcConfig()` 同步、零 IO。表直接用 Excel 维护，没有生成脚本。

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
docker run --rm -p 8213:8213 \
  -e APP_AUTH__SECRET="换成你自己的随机串" \
  -e SHELL_PASSWORD="换成你自己的口令" \
  honox-app
```

镜像里 `NODE_ENV=production`：不传 `APP_AUTH__SECRET` 就启动报错，不会带着仓库里的 dev 密钥裸奔；`SHELL_PASSWORD` 同理（`/shell` 在 JWT 白名单里，对它唯一的门就是这个口令）。`ENV` 默认 `dev`，换成其它值要先加对应的 `res/config/app_<env>.yml`（`app_fat.yml` 没写 `auth.secret`，跑 fat 得靠 `APP_AUTH__SECRET`）。镜像不带 `node_modules`：`dist/index.js` 是自包含产物；`res/` 是运行时 fs 读的，整目录拷进镜像。
