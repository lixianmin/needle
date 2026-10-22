import type { ConsoleSource } from "./source.js";

const DEFAULT_MAX_BODY_BYTES = 4096;

export interface ExecHttpOptions {
  source: ConsoleSource;
  maxBodyBytes?: number;
}

type Body =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

function json(body: Body, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * `POST /exec` 的处理函数。
 *
 * 这里只做 HTTP 相关的事：限额、解析、状态码映射。命令执行、鉴权、超时
 * 都在 source 里，浏览器里的本地适配器走的是同一段逻辑。
 */
export function createExecHandler(options: ExecHttpOptions): (req: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (req) => {
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

    const line = (parsed as { line?: unknown } | null)?.line;
    if (typeof line !== "string") {
      return json({ ok: false, error: "line 必须是字符串" }, 400);
    }
    // 空命令是畸形请求，不是业务结果，走 400 而不是 200。
    if (line.trim() === "") return json({ ok: false, error: "空命令" }, 400);

    const result = await options.source.exec(line, bearerToken(req.headers.get("authorization")));
    if (result.ok) return json({ ok: true, output: result.output });
    return result.unauthorized === true
      ? json({ ok: false, error: result.error }, 401)
      : json({ ok: false, error: result.error });
  };
}
