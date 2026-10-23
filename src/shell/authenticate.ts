import { readTextLimited } from "../core/web/body.js";
import { ResponseX } from "../core/web/responsex.js";
import type { ShellSource } from "./source.js";

const DEFAULT_MAX_BODY_BYTES = 512;

export interface AuthRouteOptions {
  source:ShellSource;
  maxBodyBytes?: number;
}


/**
 * `POST /auth`：Shell 拿到密码的唯一入口。
 *
 * 单独开一个接口，而不是把密码拼成 `login user pass` 命令：命令串会进
 * 本地历史、会在输出区回显、会出现在服务端日志里。密码只在这一条路径上流动，
 * 而且请求体上限只有 512 字节。
 */
export function createAuthRoute(options: AuthRouteOptions): (req: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (req) => {
    // 密码接口更该防这一手：它不需要 token，chunked 就能绕过声明长度。
    const body = await readTextLimited(req, maxBodyBytes);
    if (body === null) {
      return ResponseX.payloadTooLarge("payload too large");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return ResponseX.badRequest("body 必须是 JSON");
    }

    const { user, password } = (parsed ?? {}) as { user?: unknown; password?: unknown };
    if (typeof user !== "string" || typeof password !== "string") {
      return ResponseX.badRequest("user 与 password 都必须是字符串");
    }

    const result = await options.source.authenticate(user, password);
    if (!result.ok) {
      return ResponseX.badCredentials(result.error);
    }
    return Response.json({ user: result.user, token: result.token });
  };
}
