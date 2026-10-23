import { fail } from "./fail.js";
import type { ConsoleSource, ExecFailureCode } from "./source.js";

const DEFAULT_MAX_BODY_BYTES = 4096;

export interface ExecHttpOptions {
  source: ConsoleSource;
  maxBodyBytes?: number;
}

/** 失败原因 → 状态码。`code` 由 source 给，适配器只做映射。 */
const FAILURE_STATUS: Record<ExecFailureCode, number> = {
  disposed: 503,
  bad_request: 400,
  unknown_command: 400,
  unauthorized: 401,
  timeout: 504,
  command_failed: 500,
};

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
    // 先看声明长度，避免为一个 100MB 的恶意请求把内存读爆。
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      return fail(413, "payload_too_large", "payload too large");
    }

    const body = await req.text();
    if (new TextEncoder().encode(body).length > maxBodyBytes) {
      return fail(413, "payload_too_large", "payload too large");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return fail(400, "bad_request", "body 必须是 JSON");
    }

    const line = (parsed as { line?: unknown } | null)?.line;
    if (typeof line !== "string") {
      return fail(400, "bad_request", "line 必须是字符串");
    }
    // 空命令是畸形请求，不是业务结果，走 400。
    if (line.trim() === "") return fail(400, "bad_request", "空命令");

    const result = await options.source.exec(line, bearerToken(req.headers.get("authorization")));
    if (result.ok) return Response.json({ output: result.output });
    return fail(FAILURE_STATUS[result.code], result.code, result.error);
  };
}
