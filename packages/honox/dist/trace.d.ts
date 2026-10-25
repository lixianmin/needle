import { type Logger } from "@needle/logo";
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
 *
 * 不绑 `method`：`path` 已经说明是哪个接口；同一路径上的 GET/POST 由 `module` 与
 * 业务参数区分，实测下来那半个字段只是让每行更长。
 */
export declare function traceOf(ctx: Context<HonoxEnv>, log?: Logger): Trace;
//# sourceMappingURL=trace.d.ts.map