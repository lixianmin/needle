import { logo } from "@needle/logo";
import { ResponseX } from "@needle/shell";
const LEVELS = ["debug", "info", "warn", "error"];
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
 *
 * 不绑 `method`：`path` 已经说明是哪个接口；同一路径上的 GET/POST 由 `module` 与
 * 业务参数区分，实测下来那半个字段只是让每行更长。
 */
export function traceOf(ctx, log) {
    // 优先用本次请求装配的 logger（createHonox 传进来的），没有才退回全局 logo。
    const write = log ?? ctx.get("log") ?? logo;
    const where = ctx.get("api");
    const base = {
        rid: ctx.get("rid"),
        uid: ctx.get("uid"),
        path: ctx.req.path,
        ...(where === undefined ? {} : { module: where.module, site: where.site, fn: where.fn }),
    };
    const trace = {};
    for (const level of LEVELS) {
        trace[level] = (...args) => {
            write[level](base, ...args);
            return trace;
        };
    }
    trace.json = (body, status) => {
        trace.info({ status: status ?? 200, result: body });
        return ctx.json(body, status);
    };
    trace.notFound = (message = DEFAULT_NOT_FOUND) => {
        // 与 json 同一条规则：记的就是返回的响应体。
        trace.info({ status: 404, result: { code: "not_found", message } });
        return ResponseX.notFound(message);
    };
    return trace;
}
