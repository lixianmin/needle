import type { Logger } from "@needle/logo";
import type { JWTPayload } from "hono/utils/jwt/types";
/** 取 token 失败的原因。门禁据此选 401 的 message。 */
export type AuthErrorReason = "missing" | "invalid" | "expired";
/** 白名单条目：字符串表示任意方法，对象表示方法精确匹配。 */
export type PublicEntry = string | {
    method: string;
    path: string;
};
/**
 * 中间件塞进 ctx.var 的全部内容。
 *
 * 只放**每个请求独有**的东西：配置是进程级单例（用 viper 取值器直接 import），
 * 日志是进程级单例（直接用 `logo`），都不该按请求复制一份进 context。
 */
export interface HonoxEnv {
    Variables: {
        uid: string | null;
        user: JWTPayload | null;
        authError: AuthErrorReason | null;
        rid: string;
        /**
         * 本次请求用的 logger，由 `installMiddleware` 写入。
         *
         * 这是「日志不进 request context」那条决策的唯一例外：`traceOf(ctx)` 要拿到
         * `createHonox({ logger })` 配的那个实例，否则业务日志会绕过装配跑进全局 logo。
         */
        logger?: Logger;
        /**
         * 由 `createApi()` / `apiRoute()` 写入：这个请求属于哪个模块。
         *
         * `module` 是手写的一次性身份（打包、压缩后唯一还活着的定位信息），
         * `traceOf(ctx)` 把它放进日志前缀，不重复写进 JSON。
         */
        api?: {
            module: string;
        };
    };
}
//# sourceMappingURL=types.d.ts.map