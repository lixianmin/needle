import { createApi, traceOf } from "@needle/honox";
import { sign } from "hono/jwt";
import { LoginBody } from "../beans/login.js";
import { viper } from "../viper.js";

export const loginApi = createApi("api/login");

/** token 有效期 1 小时：够点完一轮按钮，又不至于在浏览器里留一个不过期的凭据。 */
const TOKEN_TTL_SECONDS = 60 * 60;

/** 没给 uid 时用这个，页面上能一眼看出是测试台签的。 */
const DEFAULT_UID = "mock-user";

/**
 * mock 登录：body `{"uid":"alice"}`，把 uid 原样签进 token，不校验密码。
 *
 * 参数走 body 不走 query：登录参数不该出现在 URL 里（会进网关日志、代理缓存、
 * 浏览器历史），而且带模型的写法只有 body 一侧能做严格 JSON 校验——
 * `ctx.req.query()` 是绕过 schema 和统一 400 出口的裸读。
 *
 * 签出来的 token 与线上完全同构（HS256、uid 在 `sub`、带 `exp`），所以测试台走的是
 * 真实的鉴权链路。接真登录时替换这个文件即可，路由形状不用改。
 *
 * 日志只记 uid，**不记 token**：凭据不能落到日志文件里。为此这里用 `trace.info()`
 * 加原生 `ctx.json()`，而不是 `trace.json()`——后者会把响应体原样打出来。
 */
loginApi.post("/login", LoginBody, (ctx, request) => {
  // 空串按“没给”处理：`{"uid":""}` 不该签出一枚 sub 为空的 token。
  const uid = request.uid === undefined || request.uid === "" ? DEFAULT_UID : request.uid;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = (now + TOKEN_TTL_SECONDS) * 1000;

  traceOf(ctx).info({ step: "login", uid });

  return sign(
    { sub: uid, iat: now, exp: now + TOKEN_TTL_SECONDS },
    viper.getString("auth.secret"),
    "HS256",
  ).then((token) => ctx.json({ uid, token, expiresAt }));
});
