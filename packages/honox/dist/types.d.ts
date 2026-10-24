import type { Logger } from "@needle/logo";
import type { JWTPayload } from "hono/utils/jwt/types";
/** 取 token 失败的原因。门禁据此选 401 的 message。 */
export type AuthErrorReason = "missing" | "invalid" | "expired";
/** 白名单条目：字符串表示任意方法，对象表示方法精确匹配。 */
export type PublicEntry = string | {
    method: string;
    path: string;
};
/** 中间件塞进 c.var 的全部内容。 */
export interface HonoxEnv<C extends object = Record<string, unknown>> {
    Variables: {
        uid: string | null;
        user: JWTPayload | null;
        authError: AuthErrorReason | null;
        config: C;
        log: Logger;
        rid: string;
    };
}
