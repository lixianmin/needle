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
| `/login` | POST | 公开 | 用户名 + 口令哈希换 JWT |

两条都进 `allowAnonymous`——**页面和登录必须匿名可达**，否则第一次访问就卡在 401，
没有任何办法拿到 token（鸡生蛋）。

`/health`、`/`、`/login` 是仅有的三条公开路径；`/bots` 保持需要 JWT，这样测试台才能
演示「不带 token → 401，带 token → 200」这条链路，而不是把一个鉴权示例改成免鉴权。

## 3. 登录契约

```
POST /login   {"user":"alice","passcode":"<sha256hex(盐+密码)>"}
→ 200 {"uid":"u-alice","token":"<HS256 JWT>","expiresAt":1761360000000}
→ 400   body 不是合法 JSON / 缺字段 / 带了未声明字段
→ 401   {"code":"unauthorized","message":"用户名或密码错误"}
```

- **客户端只给用户名，uid 从服务端记录里取**，绝不从请求里收 uid——否则谁都能声称
  自己是任何人。`user` 与 `uid` 是两件事，`sub` 写的是 uid。
- `passcode = sha256hex(DEMO_SALT + 明文密码)`：明文密码不出浏览器，服务端只存哈希。
  盐是 `app/api/login.ts` 里的常量，`res/web/home.html` 里那份必须与它一致。
- **这是示范，不是安全方案**：固定盐不防重放（截获到 passcode 就能再登一次），也不防
  离线爆破。真实项目要每用户独立盐 + 一次性挑战（nonce / 短信验证码）：客户端拿
  挑战 → 算 `hash(盐+挑战+密码)` → 服务端用同一份盐和那次挑战重算，并当场作废。
  计时侧信道、限流、失败锁定都不在示例范围。
- 用户名不存在与口令不对回**同一个** 401：能区分两者，就等于送了一个用户名枚举接口。
  比对用恒时间比较，不逐字符提前返回。
- 测试用户硬编码在 `app/api/login.ts`：`alice` / `alice123`（uid `u-alice`）、
  `bob` / `bob123`（uid `u-bob`）。
- token 用 `auth.secret` 签，payload `{ sub: uid, iat, exp }`——与 `createAuthGuard` 的校验口径
  完全一致（`sub` 取 uid、HS256）。所以这枚 token 与线上签出来的没有区别，测试台测的是
  真实链路，不是一条假路径。后续接口带 `Authorization: Bearer`，中间件解出 uid。
- `exp` = 现在 + 1 小时（`TOKEN_TTL_SECONDS`）。够点完一轮按钮，又不会在浏览器里留一个
  永不过期的凭据。
- **参数走 body，不走 query。** 登录参数不该出现在 URL 里（会进网关日志、代理缓存、
  浏览器历史）；带模型的写法也是唯一能做严格 JSON 校验、统一 400 出口的入口。body 模型
  见 `app/beans/login.ts`（`LoginBody`）。

日志：登录只记 `{user, uid}`，**不记 passcode、不记 token**。passcode 等价于密码、
token 是凭据，两者都不能进日志文件——这正是「业务自己决定打什么」要兑现的场景，
所以这里用 `trace.info(...)` + 原生 `ctx.json(...)`，而不是 `trace.json(...)`
（后者会把响应体原样落盘）。

## 4. 页面

单文件、零依赖、零构建：`res/web/home.html`。选择 `res/` 而不是 `app/` 的原因——`res/`
已经随 Docker 一起拷进镜像，且配置也是按 cwd 相对路径读 `res/config`，加一个
`res/web` 不引入新的路径约定。HTML 在启动时 `readFileSync` 一次读进内存，请求路径零 IO。

布局（左侧按钮、右侧响应）：

1. **登录态**：用户名 + 密码输入框，登录后显示 uid、token 前 12 位、过期时间与 `登录 / 退出`
   按钮。token 存 localStorage，
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
- 登录在生产构建里依然存在（示例仓库只演示，不发布），README 里写明它不是完整的安全边界。
