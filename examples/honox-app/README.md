# honox-app

`@needle/honox` 的示例：配置 + JWT 鉴权 + 每请求日志 + Excel 模板表 + Shell 面板。路由直接挂在 `createHonox()` 返回的 Hono 实例上，不引入 npm 上的 `honox`（HonoX）——见“为什么不是 HonoX”。

## 依赖怎么来

`@needle/*` 三个包还没发 npm，这里用 `link:` 指向仓库里的 `packages/*`（`bun install` 会建立软链接，不需要 `bun link` 的全局注册）。本示例有**自己的** `node_modules`、`bun.lock` 和 `tsconfig.json`，不进仓库根 workspace：`bun install --frozen-lockfile` 与 Docker 构建要能独立复现。TypeScript 与根同版本（`7.0.2`，有测试钉住）。

```bash
bun install     # 装 hono / typescript 等
bun run build   # bun build → dist/index.js（自包含产物）
SHELL_PASSWORD=dev bun run start   # 默认 3000 端口，PORT 可改
```

## 为什么不是 HonoX

`@needle/honox` 和 npm 上的 `honox`（HonoX）只是名字撞了：前者是本仓库的 Hono 底座（配置/鉴权/日志/Excel/Shell），后者是文件路由 + islands 的元框架。底座返回的就是 `Hono` 实例，这几个接口直接 `.get()` 挂上去，用不上文件路由。

早期示例确实接过 HonoX（`createApp({ app: createHonox(...) })`），那条接法在 spec §7 的 spike 里验过并留档，业务侧要文件路由/islands 时照抄即可。不默认带上的原因：HonoX 的岛检测走 `precinct` → `@typescript-eslint/typescript-estree`，在 TypeScript 7 上直接抛 `TypeError: ... reading 'Cjs'`，会把整个示例钉死在 TS 5.9.3；而且依赖表里会出现两个 `honox`，每次读都要解释一遍。

## 配置

- `config/common.yml`：所有环境共享。
- `config/app_<env>.yml`：只写差异项，`ENV` 决定加载哪个（默认 `dev`）。
- 环境变量覆盖：`APP_AUTH__SECRET=xxx`（`__` 分隔层级），优先级最高。

启动时缺 `auth.secret` 会直接报错，不会带着空密钥跑。

## 接口

| 路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /health` | 公开 | `{"ok":true}` |
| `GET /me` | 需要 JWT | 返回 `{ uid }`（取自 token 的 `sub`） |
| `GET /bots/:id` | 需要 JWT | 读 `res/metadata/BotTemplate.xlsx` 里 `BotTemplate` sheet 的那一行 |
| `GET /apc/:id` | 需要 JWT | 读 `res/metadata/ApcTemplate.xlsx` 里 `ApcTemplate` sheet 的那一行 |
| `GET /shell` | 公开（面板自己用 `SHELL_PASSWORD` 登录） | 调试面板 |

生成一个测试 token：

```bash
bun -e 'import { sign } from "hono/jwt"; console.log(await sign({ sub: "u1", exp: Math.floor(Date.now()/1000)+3600 }, "dev-secret-change-me", "HS256"))'
```

## Excel

两张表直接维护在 `res/metadata/` 下，用 Excel 改完保存即可，没有生成脚本。声明在 `app/lib/templates.ts`，启动时 `loadSheets()` 一次预载：

| 文件 | sheet | 列 |
|---|---|---|
| `BotTemplate.xlsx` | `BotTemplate` | `id`、`name`、`prompt` |
| `ApcTemplate.xlsx` | `ApcTemplate` | `id`、`equips`、`gender`、`name`、`buy_money`、`buy_price` |

`equips` 是 `|` 分隔的装备 id 串，`0` 表示该槽位空；库原样返回字符串，拆分交给业务。`ApcTemplate.xlsx` 里另有一张 `SelectApcConfig`，没有 `id` 列，不归 `defineSheet` 管，未加载。

规则：首行表头（小写 + trim），每行必须有数字 `id`；缺 id、非数字 id、重复 id 都会在 `loadSheets()` 时报错并给出行号。换表时改 `templates.ts` 里的文件名与 sheet 名，两边必须一致。

## Docker

构建上下文必须是仓库根，因为要把 `packages/` 一起带进去：

```bash
docker build -f examples/honox-app/Dockerfile -t honox-app .
docker run --rm -p 3000:3000 \
  -e APP_AUTH__SECRET="换成你自己的随机串" \
  -e SHELL_PASSWORD="换成你自己的口令" \
  honox-app
```

镜像里 `NODE_ENV=production`：不传 `APP_AUTH__SECRET` 就启动报错，不会带着仓库里的 dev 密钥裸奔；`SHELL_PASSWORD` 同理（`/shell` 在 JWT 白名单里，对它唯一的门就是这个口令）。`ENV` 默认 `dev`，换成其它值要先加对应的 `config/app_<env>.yml`，否则启动直接报找不到环境配置。镜像不带 `node_modules`：`dist/index.js` 是自包含产物。
