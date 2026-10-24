import { type Logger } from "@needle/logo";
import { type ServerShellOptions } from "@needle/shell";
import { Hono } from "hono";
import type { AuthOptions } from "./auth.js";
import type { HonoxEnv, PublicEntry } from "./types.js";
export interface HonoxOptions {
    /** 请求日志用哪个 logger；默认 `@needle/logo` 的全局 `logo`。 */
    logger?: Logger;
    /** 解 token 的配置。白名单不在这里——用返回实例的 `allowAnonymous()`。 */
    auth: AuthOptions;
    /** 传了就把 Shell 控制台挂到 shell.basePath（默认 "/shell"）。 */
    shell?: ServerShellOptions;
    /**
     * 慢请求阈值（毫秒），0 关闭。默认 1000：够长，正常接口不会被刷成 warn；
     * 够短，慢数据库往返跑不掉。请求日志其余部分由业务用 `traceOf(ctx)` 自己写。
     */
    slowMs?: number;
}
/**
 * `createHonox` 的返回值：Hono 实例 + 白名单声明入口。
 *
 * 用交叉类型而不是包装类，`app.route()` / `app.get()` 的 Hono 类型照旧可用。
 */
export type HonoxApp = Hono<HonoxEnv> & {
    /**
     * 声明这些路径不收 JWT 门禁（见 spec 8.3）。多次调用累加，返回实例本身可链式。
     *
     * 在挂载接口的地方调（示例是 `app/api/index.ts`），别塞回 `createHonox`：
     * 那是装配文件，把安全策略写进去等于加一个公开接口要动两个文件。
     */
    allowAnonymous(entries: readonly PublicEntry[]): HonoxApp;
};
/**
 * 装配一个 Hono app：建实例 → 装中间件链（见 middleware.ts）→ 挂 Shell 面板。
 *
 * 业务路由挂在返回值上，所以自动继承中间件链。
 */
export declare function createHonox(options: HonoxOptions): HonoxApp;
export type { Config } from "./config.js";
export { apiRoute, createApi } from "./route.js";
export type { ApiHandler } from "./route.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
export { RequestError, isRequestError } from "./request.js";
export { traceOf } from "./trace.js";
export type { Trace } from "./trace.js";
export { modelSchema, registerModel } from "./model.js";
export type { ModelClass } from "./model.js";
export type { ParsedHandler } from "./route.js";
//# sourceMappingURL=index.d.ts.map