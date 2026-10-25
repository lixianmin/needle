import { createApi, traceOf } from "@needle/honox";
import { ResponseX } from "@needle/shell";
import { sign } from "hono/jwt";
import { LoginBody } from "../beans/login.js";
import { viper } from "../viper.js";

/** token 有效期 1 小时：够点完一轮按钮，又不至于在浏览器里留一个不过期的凭据。 */
const TOKEN_TTL_SECONDS = 60 * 60;

/**
 * 两个测试用户。`passcode = sha256hex("needle-demo-salt" + 明文密码)`，离线算好写死；
 * 盐只在客户端 `res/web/home.html` 里参与计算，服务端不存它、也没有代码用到它。
 * 改密码要同步改 `res/web/home.html` 里输入框的默认值。
 *
 * 固定盐**不是完整的安全方案**：固定盐不防重放（截获到 passcode 就能再登录一次），
 * 也不防离线爆破。真实项目要每用户独立盐 + 一次性挑战（nonce 或短信验证码）。
 *
 * - `alice` / `alice123` → uid `u-alice`
 * - `bob` / `bob123` → uid `u-bob`
 *
 * 用 `Map` 而不是对象字面量：`{"user":"__proto__"}` 在对象上会取到
 * `Object.prototype`，`record.passcode` 是 undefined，随后 `.length` 直接 500。
 */
const USERS = new Map<string, { uid: string; passcode: string }>([
  [
    "alice",
    { uid: "u-alice", passcode: "6c47fcd7420e0e20de8802bb86353357221abd0c2ceda4256bcc0c286c76f217" },
  ],
  [
    "bob",
    { uid: "u-bob", passcode: "eccc6db82207fb37fa34a0071d6ce47618f222c7eb4fa935dcdd3e65821f7b1c" },
  ],
]);

/** 恒时间比较：逐字符提前返回会把 passcode 的前缀泄露给计时侧信道。 */
function passcodeMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return diff === 0;
}

/**
 * 登录：body `{"user":"alice","passcode":"<sha256hex(盐+密码)>"}`，签一枚 JWT。
 *
 * 用户名和 uid 是两件事：客户端只给用户名，uid 从服务端记录里取，**绝不从请求里
 * 收 uid**——否则就是「谁都能声称自己是任何人」。签出来的 token 与线上同构
 * （HS256、uid 在 `sub`、带 `exp`），后续接口靠 `createAuthGuard` 解出 uid。
 *
 * 参数走 body 不走 query：登录参数不该出现在 URL 里（会进网关日志、代理缓存、
 * 浏览器历史），带模型的写法也是唯一能做严格 JSON 校验的入口。
 *
 * 日志只记 user / uid，**不记 passcode 也不记 token**：passcode 等价于密码，
 * token 是凭据，两者都不能落进日志文件。为此这里用 `trace.info()` 加原生
 * `ctx.json()`，而不是 `trace.json()`——后者会把响应体原样打出来。
 */

export function createLoginApi() {
  // 本组挂在 `/api/v1/login` 下：登录只有一个资源，组内路径就是 `/`
  const api = createApi("login.ts");

  api.post("/", LoginBody, (ctx, request) => {
    const record = USERS.get(request.user);
    if (record === undefined || !passcodeMatches(request.passcode, record.passcode)) {
      // 用户名不存在与口令不对回同一个响应：能区分两者，就等于送了一个用户名枚举接口。
      traceOf(ctx).info({ step: "login-failed", user: request.user });
      return ResponseX.unauthorized("用户名或密码错误");
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = (now + TOKEN_TTL_SECONDS) * 1000;
    traceOf(ctx).info({ step: "login", user: request.user, uid: record.uid });

    return sign(
      { sub: record.uid, iat: now, exp: now + TOKEN_TTL_SECONDS },
      viper.getString("auth.secret"),
      "HS256",
    ).then((token) => ctx.json({ uid: record.uid, token, expiresAt }));
  });

  return api;
}