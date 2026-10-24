import { type Logger } from "@needle/logo";
import { type ServerShellOptions } from "@needle/shell";
import { Hono } from "hono";
import type { AuthOptions } from "./auth.js";
import type { HonoxEnv } from "./types.js";
export interface HonoxOptions<C extends object> {
    config: C;
    /** 默认 @needle/logo 的 logo 实例。 */
    log?: Logger;
    auth: AuthOptions;
    /** 传了就把 Shell 控制台挂到 shell.basePath（默认 "/shell"）。 */
    shell?: ServerShellOptions;
}
/**
 * 装配一个 Hono app：建实例 → 装中间件链（见 middleware.ts）→ 挂 Shell 面板。
 *
 * 业务路由挂在返回值上，所以自动继承中间件链。
 */
export declare function createHonox<C extends object>(options: HonoxOptions<C>): Hono<HonoxEnv<C>>;
export type { Config } from "./config.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
//# sourceMappingURL=index.d.ts.map