import { nextUlid } from "@needle/got";
import { createAuth } from "./auth.js";
import { isRequestError } from "./request.js";
/** 入站请求可以自带 rid：`x-rid` 优先，其次是网关常见的 `x-request-id`。 */
const RID_HEADERS = ["x-rid", "x-request-id"];
/**
 * 接受外部 rid 的形状：只放行不会破坏日志行的字符。
 * 不加这道限制，请求头里塞换行就能伪造日志行（log injection）。
 */
const RID_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;
/**
 * 慢请求阈值默认值。1000ms 是「人肉等待仍可接受」的上界，也覆盖了慢数据库
 * 往返的典型量级；更小的值会把正常请求也刷成 warn。
 */
export const DEFAULT_SLOW_MS = 1000;
function resolveRid(header) {
    for (const name of RID_HEADERS) {
        const value = header(name);
        if (value !== undefined && RID_PATTERN.test(value)) {
            return value;
        }
    }
    // 自己生成时是 26 位 ULID：时间在前、80 位随机在后。
    // 不用 Snowflake：rid 不需要机器号，多实例也不必互相协调位宽。
    return nextUlid();
}
/** 保留 1 位小数：毫秒精度够定位慢请求，也不会让日志字段变成浮点长尾。 */
function elapsedMs(start) {
    return Math.round((performance.now() - start) * 10) / 10;
}
/** 路由注册时记下的模块身份（没包 createApi / apiRoute 就没有）。 */
function moduleOf(c) {
    const where = c.get("api");
    return where === undefined ? {} : { module: where.module };
}
/**
 * 只兜两种业务补不了的日志：500 和慢请求。其余请求一律不记——打什么由业务
 * 用 `traceOf(ctx)` 自己决定（health 这类接口本来就该是零日志）。
 *
 * 500 的日志放在这里而不是 `onError`：业务可以自己 `app.onError`（单槽替换），
 * 替换掉之后库里的日志就没了；而 `c.error` 是 compose 写的，与谁处理无关。
 *
 * 非 Error 抛出不会进 `onError`（compose 只认 `instanceof Error`），会穿到这里，
 * 所以 catch 那一路也必须记一条，然后原样 rethrow。
 */
function createFallbackLog(log, slowMs) {
    return async function fallbackLog(c, next) {
        const started = performance.now();
        const base = () => ({
            rid: c.get("rid"),
            method: c.req.method,
            path: c.req.path,
            ...moduleOf(c),
        });
        try {
            await next();
        }
        catch (error) {
            log.error({ ...base(), status: 500 }, error);
            throw error;
        }
        const durationMs = elapsedMs(started);
        const uid = c.get("uid");
        // 没 finalize 时读 c.res 会惰性造一个 200，那会把失败记成成功。
        const status = c.finalized ? c.res.status : 500;
        if (c.error !== undefined) {
            // 客户端传错参数不是服务端故障：onError 已经把它映射成 4xx。
            if (isRequestError(c.error)) {
                return;
            }
            log.error({ ...base(), status, durationMs, uid }, c.error);
            return;
        }
        // error 行已经带 durationMs，慢请求只补没出错的那一路，避免一次慢失败记两条。
        if (slowMs > 0 && durationMs >= slowMs) {
            log.warn({ ...base(), status, durationMs, uid });
        }
    };
}
/**
 * 依次装上 rid → 兜底日志 → JWT → 门禁，顺序由库固定。
 *
 * 顺序不能交给业务：日志排在门禁前面，401 才有日志；JWT 排在门禁前面，
 * 门禁才看得到 uid。这两个顺序错一个，症状都很隐蔽。
 */
export function installMiddleware(app, options) {
    app.use("*", async (c, next) => {
        // 调用方带了就用它的（网关/上游的链路 id 才能串起来），没带才自己生成。
        const rid = resolveRid((name) => c.req.header(name));
        c.set("rid", rid);
        c.set("log", options.log);
        await next();
        c.header("x-rid", rid);
    });
    app.use("*", createFallbackLog(options.log, options.slowMs ?? DEFAULT_SLOW_MS));
    app.use("*", createAuth(options.auth, options.public, options.log));
}
