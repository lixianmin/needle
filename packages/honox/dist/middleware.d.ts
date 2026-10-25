import type { Logger } from "@needle/logo";
import type { Hono } from "hono";
import { type AuthOptions } from "./auth.js";
import type { HonoxEnv, PublicEntry } from "./types.js";
/**
 * 慢请求阈值默认值。1000ms 是「人肉等待仍可接受」的上界，也覆盖了慢数据库
 * 往返的典型量级；更小的值会把正常请求也刷成 warn。
 */
export declare const DEFAULT_SLOW_MS = 1000;
export interface MiddlewareOptions {
    logger: Logger;
    /** 解 token 的密钥、claim、token 来源。 */
    auth: AuthOptions;
    /** 已合并 Shell 路径的白名单；数组引用共享，后续 append 的条目即生效。 */
    public: readonly PublicEntry[];
    /** 超过这个毫秒数记一条慢请求日志；0 关闭。默认 {@link DEFAULT_SLOW_MS}。 */
    slowMs?: number;
}
/**
 * 依次装上 rid → 兜底日志 → JWT → 门禁，顺序由库固定。
 *
 * 顺序不能交给业务：日志排在门禁前面，401 才有日志；JWT 排在门禁前面，
 * 门禁才看得到 uid。这两个顺序错一个，症状都很隐蔽。
 */
export declare function installMiddleware(app: Hono<HonoxEnv>, options: MiddlewareOptions): void;
//# sourceMappingURL=middleware.d.ts.map