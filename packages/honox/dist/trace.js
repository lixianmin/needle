import { logo } from "@needle/logo";
const LEVELS = ["debug", "info", "warn", "error"];
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
export function traceOf(ctx, log = logo) {
    const where = ctx.get("api");
    const base = {
        rid: ctx.get("rid"),
        uid: ctx.get("uid"),
        method: ctx.req.method,
        path: ctx.req.path,
        ...(where === undefined ? {} : { module: where.module, site: where.site, fn: where.fn }),
    };
    const trace = {};
    for (const level of LEVELS) {
        trace[level] = (...args) => {
            log[level](base, ...args);
        };
    }
    return trace;
}
