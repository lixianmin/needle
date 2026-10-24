import type { Logger } from "@needle/logo";
import type { MiddlewareHandler } from "hono";
import type { HonoxEnv, PublicEntry } from "./types.js";
export interface AuthOptions {
    /** HS256 密钥 */
    secret: string;
    /** uid 取自哪个 claim，默认 "sub" */
    claim?: string;
    /** 默认 "authorization"（Bearer token） */
    header?: string;
    /** 可选：header 里没 token 时从这个 cookie 兜底 */
    cookie?: string;
}
/** query 串不参与匹配：白名单记的是路由形状，不是某一次请求的完整 URL。 */
export declare function matchesPublic(entries: readonly PublicEntry[], method: string, path: string): boolean;
/**
 * 解 token + 门禁，一个中间件做完：解析失败不抛错，只把 uid 留空，
 * 让门禁统一决定 401。这样公开接口上带了个坏 token 也不会被拒。
 *
 * 白名单是第二个参数而不是 options 的字段：它是策略，不是「怎么解 token」的配置。
 * 传数组引用（不是拷贝），调用方后续往里 append 的条目对每个请求都生效。
 */
export declare function createAuth(options: AuthOptions, entries: readonly PublicEntry[], log: Logger): MiddlewareHandler<HonoxEnv>;
//# sourceMappingURL=auth.d.ts.map