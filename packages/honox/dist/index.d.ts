import { type Logger } from "@needle/logo";
import { type ServerShellOptions } from "@needle/shell";
import { Hono } from "hono";
import type { AuthOptions } from "./auth.js";
import { type SnowflakeOptions } from "./id.js";
import type { HonoxEnv } from "./types.js";
export interface HonoxOptions {
    /** 请求日志用哪个 logger；默认 `@needle/logo` 的全局 `logo`。 */
    logger?: Logger;
    /** rid 的 Snowflake 配置；epoch 与 nodeId 都该显式给（多实例必须不同 nodeId）。 */
    id?: SnowflakeOptions;
    auth: AuthOptions;
    /** 传了就把 Shell 控制台挂到 shell.basePath（默认 "/shell"）。 */
    shell?: ServerShellOptions;
}
/**
 * 装配一个 Hono app：建实例 → 装中间件链（见 middleware.ts）→ 挂 Shell 面板。
 *
 * 业务路由挂在返回值上，所以自动继承中间件链。
 */
export declare function createHonox(options: HonoxOptions): Hono<HonoxEnv>;
export type { Config } from "./config.js";
export { apiRoute, createApi } from "./route.js";
export type { ApiHandler } from "./route.js";
export { createSnowflake, parseSnowflake } from "./id.js";
export type { Snowflake, SnowflakeOptions } from "./id.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
//# sourceMappingURL=index.d.ts.map