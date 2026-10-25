import { logo } from "@needle/logo";
import { ResponseX } from "@needle/shell";
const DEFAULT_BAD_REQUEST = "请求不合法";
const DEFAULT_NOT_FOUND = "接口不存在";
const DEFAULT_INTERNAL_ERROR = "服务内部错误";
const DEFAULT_UNAVAILABLE = "服务暂不可用";
/**
 * `Trace` 的原型方法实现：每个请求只分配一个实例，九个方法挂在原型上共享。
 *
 * 早先是每次创建时现挂九个闭包。改成原型方法实测（Bun 1.4.4，创建 + 打一条
 * info）65ns → 24ns，常驻 680B → 88B / trace：闭包版的九个箭头函数加它们共享的
 * context 都是真实堆分配，V8/JSC 不会为这种形状做逃逸分析。绝对值不大（trace
 * 只占一个进程内请求的 ~3%，真实请求还要加网络与 IO），但没有理由白送垃圾。
 *
 * 代价是方法依赖 `this`：`trace.info()`、`trace["json"]()`、`trace.info().json()`
 * 都正常（成员调用表达式的 `this` 永远是接收者），但把方法摘下来单独调用
 * （`const { json } = trace; json(...)`）会抛 TypeError。要传给别处就传 trace 本身。
 */
class RequestTrace {
    /** 响应出口要用它造响应。 */
    ctx;
    write;
    /** 绑定字段。生成时从 ctx 取干净，之后打日志不再碰 ctx。 */
    base;
    constructor(ctx, write) {
        this.ctx = ctx;
        this.write = write;
        const where = ctx.get("api");
        this.base = {
            rid: ctx.get("rid"),
            uid: ctx.get("uid"),
            path: ctx.req.path,
            ...(where === undefined ? {} : { module: where.module }),
        };
    }
    debug(...args) {
        this.write.debug(this.base, ...args);
        return this;
    }
    info(...args) {
        this.write.info(this.base, ...args);
        return this;
    }
    warn(...args) {
        this.write.warn(this.base, ...args);
        return this;
    }
    error(...args) {
        this.write.error(this.base, ...args);
        return this;
    }
    json(body, status) {
        this.info({ status: status ?? 200, result: body });
        return this.ctx.json(body, status);
    }
    badRequest(message = DEFAULT_BAD_REQUEST) {
        // 与 json 同一条规则：记的就是返回的响应体。
        this.info({ status: 400, result: { code: "bad_request", message } });
        return ResponseX.badRequest(message);
    }
    notFound(message = DEFAULT_NOT_FOUND) {
        // 与 json 同一条规则：记的就是返回的响应体。
        this.info({ status: 404, result: { code: "not_found", message } });
        return ResponseX.notFound(message);
    }
    internalError(message = DEFAULT_INTERNAL_ERROR) {
        // 与 json 同一条规则：记的就是返回的响应体。
        this.info({ status: 500, result: { code: "internal_error", message } });
        return ResponseX.internalError(message);
    }
    unavailable(message = DEFAULT_UNAVAILABLE) {
        // 与 json 同一条规则：记的就是返回的响应体。
        this.info({ status: 503, result: { code: "service_unavailable", message } });
        return ResponseX.unavailable(message);
    }
}
/**
 * 把当前请求的上下文绑成一个 trace 对象。
 *
 * 三级来源：调用方显式传的 > 本次请求装配的 logger（`installMiddleware` 从
 * `createHonox({ logger })` 拿到的那个，写进 context）> 全局 logo。
 *
 * 中间那一级是「配置不进 request context」的唯一例外。少了它，业务侧
 * `traceOf(ctx)` 就只会落回全局 logo——`createHonox({ logger })` 配的实例被
 * 悄悄绕过，日志跑到另一个 sink，症状只在「配了 logger 却看不见业务日志」时
 * 才暴露，而那时候错过的日志已经没了。
 *
 * 为什么不挂在 `Context` 上：`ctx.error` 已经是 Hono 的公开字段（compose 每次
 * Error 抛出都会写它），挂同名方法会在类型层冲突、运行期被覆盖。
 *
 * 字段顺序：绑定字段在前、业务参数在后，同名时业务覆盖（与 logo 的「后写的赢」一致）。
 *
 * 不绑 `method`：`path` 已经说明是哪个接口；同一路径上的 GET/POST 由 `module` 与
 * 业务参数区分，实测下来那半个字段只是让每行更长。
 */
export function traceOf(ctx, logger) {
    return new RequestTrace(ctx, logger ?? ctx.get("logger") ?? logo);
}
