const DEFAULT_MAX_BODY_BYTES = 4096;
/** `Body` 在编译期锁住响应形状；序列化交给平台内置的 `Response.json`。 */
function reply(body, status = 200) {
    return Response.json(body, { status });
}
function bearerToken(header) {
    if (header === null)
        return null;
    const match = /^bearer\s+(.+)$/i.exec(header.trim());
    return match?.[1] ?? null;
}
/**
 * `POST /exec` 的处理函数。
 *
 * 这里只做 HTTP 相关的事：限额、解析、状态码映射。命令执行、鉴权、超时
 * 都在 source 里，浏览器里的本地适配器走的是同一段逻辑。
 */
export function createExecHandler(options) {
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    return async (req) => {
        // 先看声明长度，避免为一个 100MB 的恶意请求把内存读爆。
        const declared = Number(req.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > maxBodyBytes) {
            return reply({ ok: false, error: "payload too large" }, 413);
        }
        const body = await req.text();
        if (new TextEncoder().encode(body).length > maxBodyBytes) {
            return reply({ ok: false, error: "payload too large" }, 413);
        }
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            return reply({ ok: false, error: "body 必须是 JSON" }, 400);
        }
        const line = parsed?.line;
        if (typeof line !== "string") {
            return reply({ ok: false, error: "line 必须是字符串" }, 400);
        }
        // 空命令是畸形请求，不是业务结果，走 400 而不是 200。
        if (line.trim() === "")
            return reply({ ok: false, error: "空命令" }, 400);
        const result = await options.source.exec(line, bearerToken(req.headers.get("authorization")));
        if (result.ok)
            return reply({ ok: true, output: result.output });
        return result.unauthorized === true
            ? reply({ ok: false, error: result.error }, 401)
            : reply({ ok: false, error: result.error });
    };
}
