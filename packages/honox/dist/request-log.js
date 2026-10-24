/** 保留 1 位小数：毫秒精度够定位慢请求，也不会让日志字段变成浮点长尾。 */
function elapsedMs(start) {
    return Math.round((performance.now() - start) * 10) / 10;
}
/**
 * 每请求两行：`-->` 进、`<--` 出。
 *
 * 结束行放在 finally 里，并读 `c.res.status`——这样门禁短路、404、抛错
 * 三种情况都有结束行；没有它，日志里会出现"有进无出"，看不出请求是卡住还是失败。
 *
 * 错误从 `c.error` 取，而不是 try/catch：Hono 的 compose 在每一层就把异常交给
 * onError 消化掉，`await next()` 永远不会抛——写 catch 只会是一段永不执行的代码。
 * 500 长什么样仍由业务的 app.onError 决定，本库不插手。
 */
export function createRequestLog(log) {
    return async function requestLog(c, next) {
        const reqLog = log.child({ req: c.get("reqId") });
        const method = c.req.method;
        const path = c.req.path;
        const started = performance.now();
        reqLog.info({ method, path }, "-->");
        try {
            await next();
            if (c.error !== undefined) {
                reqLog.error(c.error);
            }
        }
        finally {
            reqLog.info({
                method,
                path,
                status: c.res.status,
                durationMs: elapsedMs(started),
                uid: c.get("uid"),
            }, "<--");
        }
    };
}
