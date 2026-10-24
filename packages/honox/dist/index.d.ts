import { type Logger } from "@needle/logo";
import { type ServerShellOptions } from "@needle/shell";
import { Hono } from "hono";
import { type AuthOptions } from "./auth.js";
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
 * 装配一个 Hono app：rid → 请求日志 → JWT → 门禁，顺序由库固定。
 *
 * 顺序不能交给业务：日志排在门禁前面，401 才有结束行；JWT 排在门禁前面，
 * 门禁才看得到 uid。这两个顺序错一个，症状都很隐蔽（"日志偶尔少一行"）。
 */
export declare function createHonox<C extends object>(options: HonoxOptions<C>): Hono<HonoxEnv<C>>;
export type { Config } from "./config.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
