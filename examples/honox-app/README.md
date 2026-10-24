# honox-app

`@needle/honox` 的示例：HonoX 文件路由 + 配置 + JWT 鉴权 + 每请求日志 + Excel 配置 + Shell 面板。

## 依赖怎么来

`@needle/*` 三个包还没发 npm，这里用 `link:` 指向仓库里的 `packages/*`（`bun install` 会建立软链接，不需要 `bun link` 的全局注册）。本示例有**自己的** `node_modules` 和 `bun.lock`，不进仓库根 workspace：仓库根用 TypeScript 7，而 HonoX 0.1.62 的岛检测经 `@typescript-eslint/typescript-estree` 调 TS API，在 TS 7 上直接抛 `TypeError: ... reading 'Cjs'`，构建都起不来。所以这里固定 TypeScript 5.9.3。

```bash
bun install     # 装 hono / honox / vite / typescript 5.9.3
bun run build   # vite build → dist/index.js
SHELL_PASSWORD=dev bun run start   # 默认 3000 端口，PORT 可改
```

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
| `GET /plans/:id` | 需要 JWT | 读 `res/metadata/Plan.xlsx` 里 `Plan` sheet 的那一行 |
| `GET /shell` | 公开（面板自己用 `SHELL_PASSWORD` 登录） | 调试面板 |

生成一个测试 token：

```bash
bun -e 'import { sign } from "hono/jwt"; console.log(await sign({ sub: "u1", exp: Math.floor(Date.now()/1000)+3600 }, "dev-secret-change-me", "HS256"))'
```

## Excel

`res/metadata/Plan.xlsx` 由脚本生成（也可以直接用 Excel 编辑后覆盖）：

```bash
bun scripts/make-plan-xlsx.ts
```

规则：首行表头（小写 + trim），每行必须有数字 `id`；缺 id、非数字 id、重复 id 都会在 `loadSheets()` 时报错并给出行号。

## Docker

构建上下文必须是仓库根，因为要把 `packages/` 一起带进去：

```bash
docker build -f examples/honox-app/Dockerfile -t honox-app .
docker run --rm -p 3000:3000 \
  -e APP_AUTH__SECRET="换成你自己的随机串" \
  -e SHELL_PASSWORD="换成你自己的口令" \
  honox-app
```

镜像里 `NODE_ENV=production`：不传 `APP_AUTH__SECRET` 就启动报错，不会带着仓库里的 dev 密钥裸奔；`SHELL_PASSWORD` 同理（`/shell` 在 JWT 白名单里，对它唯一的门就是这个口令）。`ENV` 默认 `dev`，要换环境再传 `-e ENV=pro`。镜像不带 `node_modules`：`dist/index.js` 是自包含产物。
