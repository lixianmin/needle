import type { AuthOptions } from "./types.js";
export interface Auth {
    /** 校验通过返回 token，否则 null。 */
    login(user: string, password: string): Promise<string | null>;
    /** 校验通过返回载荷，否则 null。任何畸形输入都返回 null，不抛。 */
    verify(token: string | null): Promise<{
        sub: string;
    } | null>;
}
export declare function createAuth(options: AuthOptions & {
    now?: () => number;
}): Auth;
