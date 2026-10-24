import { logo, type Logger } from "@needle/logo";
import { ResponseX } from "@needle/shell";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HonoxEnv } from "./types.js";

/**
 * 请求绑定的日志出口。
 *
 * 四个级别方法返回 trace 自己，所以可以一行同时"建 trace + 打第一条日志"：
 *
 * ```ts
 * const trace = traceOf(ctx).info(request);
 * ```
 *
 * `json` / `notFound` 是响应出口：记的那一行就是它返回的响应（`{status, result}`），
 * 只有一个参数。业务想额外记什么，用 `.info(...)` 显式加——链式天然支持。
 */
export interface Trace {
  debug(...args: unknown[]): Trace;
  info(...args: unknown[]): Trace;
  warn(...args: unknown[]): Trace;
  error(...args: unknown[]): Trace;
  /**
   * 记一条 info（`{status, result}`）并返回 JSON 响应。
   * 不想记这一条就用 `ctx.json`——日志和响应在这里被绑在一起，是为了让
   * "每个出口都留一行"成为默认动作，而不是要剥夺选择。
   */
  json(body: unknown, status?: ContentfulStatusCode): Response;
  /** 记一条 info（`{status: 404, result: {code, message}}`）并返回 404。 */
  notFound(message?: string): Response;
}

const LEVELS = ["debug", "info", "warn", "error"] as const;

const DEFAULT_NOT_FOUND = "接口不存在";

/**
 * 把当前请求的上下文绑成一个 trace 对象。
 *
 * 在生成的那一刻把 `ctx` 里的东西取干净：之后打日志不再碰 `ctx`（`json` /
 * `notFound` 要返回响应，仍要用它）。取一次放变量里复用，别每个出口都现取。
 *
 * 为什么不挂在 `Context` 上：`c.error` 已经是 Hono 的公开字段（compose 每次
 * Error 抛出都会写它），挂同名方法会在类型层冲突、运行期被覆盖。
 *
 * 字段顺序：绑定字段在前、业务参数在后，同名时业务覆盖（与 logo 的「后写的赢」一致）。
 */
export function traceOf(ctx: Context<HonoxEnv>, log?: Logger): Trace {
  // 优先用本次请求装配的 logger（createHonox 传进来的），没有才退回全局 logo。
  const write = log ?? ctx.get("log") ?? logo;
  const where = ctx.get("api");
  const base = {
    rid: ctx.get("rid"),
    uid: ctx.get("uid"),
    method: ctx.req.method,
    path: ctx.req.path,
    ...(where === undefined ? {} : { module: where.module, site: where.site, fn: where.fn }),
  };

  const trace = {} as Trace;
  for (const level of LEVELS) {
    trace[level] = (...args: unknown[]) => {
      write[level](base, ...args);
      return trace;
    };
  }

  trace.json = (body, status) => {
    trace.info({ status: status ?? 200, result: body });
    return ctx.json(body as never, status);
  };

  trace.notFound = (message = DEFAULT_NOT_FOUND) => {
    // 与 json 同一条规则：记的就是返回的响应体。
    trace.info({ status: 404, result: { code: "not_found", message } });
    return ResponseX.notFound(message);
  };

  return trace;
}
