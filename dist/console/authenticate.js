import { fail } from "./fail.js";
const DEFAULT_MAX_BODY_BYTES = 512;
/**
 * `POST /auth`：控制台拿到密码的唯一入口。
 *
 * 单独开一个接口，而不是把密码拼成 `login user pass` 命令：命令串会进
 * 本地历史、会在输出区回显、会出现在服务端日志里。密码只在这一条路径上流动，
 * 而且请求体上限只有 512 字节。
 */
export function createAuthRoute(options) {
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    return async (req) => {
        const declared = Number(req.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > maxBodyBytes) {
            return fail(413, "payload_too_large", "payload too large");
        }
        const body = await req.text();
        if (new TextEncoder().encode(body).length > maxBodyBytes) {
            return fail(413, "payload_too_large", "payload too large");
        }
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            return fail(400, "bad_request", "body 必须是 JSON");
        }
        const { user, password } = (parsed ?? {});
        if (typeof user !== "string" || typeof password !== "string") {
            return fail(400, "bad_request", "user 与 password 都必须是字符串");
        }
        const result = await options.source.authenticate(user, password);
        if (!result.ok)
            return fail(401, "bad_credentials", result.error);
        return Response.json({ user: result.user, token: result.token });
    };
}
