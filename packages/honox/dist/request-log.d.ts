import type { Logger } from "@needle/logo";
import type { MiddlewareHandler } from "hono";
import type { HonoxEnv } from "./types.js";
/**
 * 每请求两行：`-->` 进、`<--` 出。
 *
 * 结束行放在 finally 里，并读 `c.res.status`——这样门禁短路、404、抛错
 * 三种情况都有结束行；没有它，日志里会出现"有进无出"，看不出请求是卡住还是失败。
 *
 * 错误有两个来源：`c.error`（Error 抛出被 compose 就地交给 onError）和 catch
 * （非 Error 抛出、onError 自身抛错、自定义 notFound 抛错都会真的穿过来）。
 * 少了 catch 那一路，日志会漏掉错误；而 `c.res` 在没 finalize 时读到的是惰性 200，
 * 会把 500 记成 200。500 的响应体长什么样仍由业务决定，本库不插手。
 */
export declare function createRequestLog(log: Logger): MiddlewareHandler<HonoxEnv>;
//# sourceMappingURL=request-log.d.ts.map