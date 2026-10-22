import type { Logger } from "../core/logger.js";
import type { Auth } from "./auth.js";
import { CommandError, findCommand, splitArgs } from "./commands.js";
import type { Command, CommandOutput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 4096;

export interface ExecOptions {
  commands: readonly Command[];
  auth: Auth;
  log: Logger;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

type ExecResponse =
  | { ok: true; output: CommandOutput }
  | { ok: false; error: string };

function json(body: ExecResponse, status = 200): Response {
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
 * POST /exec 的处理函数。
 *
 * 结果走 HTTP 响应体而不是 SSE：一问一答本来就是请求/响应，同步返回省掉了
 * 一套 requestId 对账和超时清理。SSE 只负责服务端主动推的东西。
 */
export function createExecHandler(options: ExecOptions): (req: Request) => Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

    const [name, ...args] = splitArgs(line);
    if (name === undefined) {
      return json({ ok: false, error: "空命令" }, 400);
    }

    const command = findCommand(options.commands, name);
    if (command === undefined) {
      // 业务失败用 200 承载，前端据此渲染成输出区里的一行红字。
      return json({ ok: false, error: `unknown command: ${name}` });
    }

    if (command.public !== true) {
      const token = bearerToken(req.headers.get("authorization"));
      const user = await options.auth.verify(token);
      if (user === null) return json({ ok: false, error: "unauthorized" }, 401);
      return runCommand(command, args, user.sub);
    }

    return runCommand(command, args, null);
  };

  async function runCommand(
    command: Command,
    args: string[],
    user: string | null,
  ): Promise<Response> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("timeout"));
      }, timeoutMs);
    });

    try {
      const output = await Promise.race([
        Promise.resolve(command.run({ args, user, log: options.log })),
        deadline,
      ]);
      return json({ ok: true, output });
    } catch (error) {
      if (timedOut) return json({ ok: false, error: "timeout" });

      // 只回 message，不回堆栈：堆栈里有文件路径和行号，是给本地排错用的，
      // 不该顺着 HTTP 跑到浏览器里。需要细节就看服务端日志。
      const message = error instanceof CommandError ? error.message : String(error);
      return json({ ok: false, error: message });
    } finally {
      // 不清掉的话，每个请求都会留一个 10 秒定时器，进程退不掉、测试也拖尾。
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
