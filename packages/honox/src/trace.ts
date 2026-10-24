import { logo, type Logger } from "@needle/logo";
import type { Context } from "hono";
import type { HonoxEnv } from "./types.js";

/** 请求绑定的日志出口。四个级别方法只是 `logo` 的同名方法加上上下文字段。 */
export interface Trace {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const LEVELS = ["debug", "info", "warn", "error"] as const;

/**
 * 把当前请求的上下文绑成一个 trace 对象。
 *
 * 在生成的那一刻把 `ctx` 里的东西取干净，之后打日志不再碰 `ctx`——所以业务
 * 可以在 handler 顶部 `const trace = traceOf(ctx)`，也可以每次现取。
 *
 * 为什么不挂在 `Context` 上：`c.error` 已经是 Hono 的公开字段（compose 每次
 * Error 抛出都会写它），挂同名方法会在类型层冲突、运行期被覆盖。
 *
 * 字段顺序：绑定字段在前、业务参数在后，同名时业务覆盖（与 logo 的「后写的赢」一致）。
 */
export function traceOf(ctx: Context<HonoxEnv>, log: Logger = logo): Trace {
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
      log[level](base, ...args);
    };
  }
  return trace;
}
