# 首页测试台（home.html）设计

日期：2026-10-25　状态：已实现　范围：`examples/honox-app`

## 1. 要解决的问题

示例只有接口，没有入口：打开浏览器访问根目录是 404，想验证 `GET /bots` 得手写 curl 并
自己签一个 JWT（README 里那段 `bun -e '... sign(...)'`）。而 `/bots` 在 JWT 门禁后面，
不签 token 就永远是 401——「接口能跑」这件事无法用眼睛确认。

目标：访问 `/` 就能看到一张网页，点按钮发请求，登录一次之后 Bot 接口直接可用。

非目标：不是生产控制台（那是 `/shell` 的事），不替代 curl / 自动化测试，不做账号体系。

## 2. 路由

| 路径 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/` | GET | 公开 | 测试台页面本身（`res/web/home.html`） |
| `/login` | POST | 公开 | mock 登录，发一枚真 JWT |

两条都进 `allowAnonymous`——**页面和登录必须匿名可达**，否则第一次访问就卡在 401，
没有任何办法拿到 token（鸡生蛋）。

`/health`、`/`、`/login` 是仅有的三条公开路径；`/bots` 保持需要 JWT，这样测试台才能
演示「不带 token → 401，带 token → 200」这条链路，而不是把一个鉴权示例改成免鉴权。

## 3. 登录契约

```
POST /login?uid=alice          # uid 可省，默认 "mock-user"
→ 200 {"uid":"alice","token":"<HS256 JWT>","expiresAt":1761360000000}
```

- token 用 `auth.secret` 签，payload `{ sub: uid, iat, exp }`——与 `createAuth` 的校验口径
  完全一致（`sub` 取 uid、HS256）。所以这枚 token 与线上签出来的没有区别，测试台测的是
  真实链路，不是一条假路径。
- `exp` = 现在 + 1 小时（`TOKEN_TTL_SECONDS`）。够点完一轮按钮，又不会在浏览器里留一个
  永不过期的凭据。
- **这是 mock，不校验密码**：只把 `uid` 原样签进 token。生产接真登录时替换这个文件即可，
  路由形状不用改。

日志：登录只记 `{uid}`，**不记 token**。凭据不能进日志文件——这正是「业务自己决定打
什么」要兑现的场景，所以这里用 `trace.info(...)` + 原生 `ctx.json(...)`，而不是
`trace.json(...)`（后者会把响应体原样落盘，token 就跟着进去了）。

## 4. 页面

单文件、零依赖、零构建：`res/web/home.html`。选择 `res/` 而不是 `app/` 的原因——`res/`
已经随 Docker 一起拷进镜像，且配置也是按 cwd 相对路径读 `res/config`，加一个
`res/web` 不引入新的路径约定。HTML 在启动时 `readFileSync` 一次读进内存，请求路径零 IO。

布局（左侧按钮、右侧响应）：

1. **登录态**：uid、token 前 16 位、过期时间、`登录 / 退出` 按钮。token 存 localStorage，
   刷新不掉。
2. **接口按钮**：每个按钮就是一条 `data-method` + `data-path` + `data-body` 声明，
   JS 只负责发请求和渲染。加一个用例 = 加一行 `<button>`。
3. **自由请求**：方法下拉 + 路径输入 + body 文本域，覆盖按钮没收录的情况。
4. **响应**：状态码（200 绿 / 4xx 黄 / 5xx 红）、`x-rid`、耗时、格式化后的 JSON。

按钮清单（对应示例的每条分支）：

| 按钮 | 期望 |
|---|---|
| `GET /health` | 200 `{"ok":true}` |
| `POST /login` | 200 拿到 token |
| `GET /bots`（带 token） | 200 全表 |
| `GET /bots?id=1` | 200 单条 |
| `GET /bots?id=999` | 404 |
| `GET /bots?id=abc` | 400（query 校验） |
| `POST /bots` `{"ids":[1,99]}` | 200 `bots` + `missing` |
| `POST /bots` `{}` | 400（body 校验） |
| `GET /bots`（强制不带 token） | 401，演示门禁 |

最后一条用 `data-auth="0"` 标记：即使已登录也故意不带 Authorization，否则测不出 401。

## 5. 边界

- 页面本身**零日志**：`GET /` 不写 trace，演示「探活/静态页这类高频请求不该有日志噪音」。
- 不做 CORS：页面与接口同源。
- 不做 markdown/文件预览：`prompt` 字段按 JSON 原样展示。
- mock 登录在生产构建里依然存在（示例仓库只演示，不发布），README 里写明它不是安全边界。
