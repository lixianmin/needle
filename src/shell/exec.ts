import { readTextLimited } from "../core/web/body.js";
import { ResponseX } from "../core/web/responsex.js";
import type { ShellSource } from "./source.js";

const DEFAULT_MAX_BODY_BYTES = 4096;

export interface ExecHttpOptions {
  source:ShellSource;
  maxBodyBytes?: number;
}

function bearerToken(header: string | null): string | null {
  if (header === null) {
    return null;
  }
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
    // 边读边计数：chunked 请求没有 content-length，先读后检查等于没检查。
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

    const line = (parsed as { line?: unknown } | null)?.line;
    if (typeof line !== "string") {
      return ResponseX.badRequest("line 必须是字符串");
    }
    // 空命令是畸形请求，不是业务结果，走 400。
    if (line.trim() === "") {
      return ResponseX.badRequest("空命令");
    }

    const result = await options.source.exec(line, bearerToken(req.headers.get("authorization")));
    if (result.ok) {
      return Response.json({ data: result.output });
    }

    // 内部失败原因比线上 code 细：一个状态码只配一个 code，细分靠 message。
    switch (result.code) {
      case "disposed":
        return ResponseX.unavailable(result.error);
      case "unauthorized":
        return ResponseX.unauthorized(result.error);
      case "timeout":
        return ResponseX.gatewayTimeout(result.error);
      case "command_failed":
        return ResponseX.internalError(result.error);
      case "bad_request":
      case "unknown_command":
        return ResponseX.badRequest(result.error);
    }
  };
}
