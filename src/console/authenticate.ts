import type { ConsoleSource } from "./source.js";

const DEFAULT_MAX_BODY_BYTES = 512;

export interface AuthRouteOptions {
  source: ConsoleSource;
  maxBodyBytes?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * `POST /auth`：控制台拿到密码的唯一入口。
 *
 * 单独开一个接口，而不是把密码拼成 `login user pass` 命令：命令串会进
 * 本地历史、会在输出区回显、会出现在服务端日志里。密码只在这一条路径上流动，
 * 而且请求体上限只有 512 字节。
 */
export function createAuthRoute(options: AuthRouteOptions): (req: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (req) => {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      return json({ ok: false, error: "payload too large" }, 413);
    }

    const body = await req.text();
    if (new TextEncoder().encode(body).length > maxBodyBytes) {
      return json({ ok: false, error: "payload too large" }, 413);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ ok: false, error: "body 必须是 JSON" }, 400);
    }

    const { user, password } = (parsed ?? {}) as { user?: unknown; password?: unknown };
    if (typeof user !== "string" || typeof password !== "string") {
      return json({ ok: false, error: "user 与 password 都必须是字符串" }, 400);
    }

    const result = await options.source.authenticate(user, password);
    if (!result.ok) return json({ ok: false, error: result.error }, 401);
    return json({ ok: true, user: result.user, token: result.token });
  };
}
