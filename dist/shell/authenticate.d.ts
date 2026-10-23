import type { ShellSource } from "./source.js";
export interface AuthRouteOptions {
    source: ShellSource;
    maxBodyBytes?: number;
}
/**
 * `POST /auth`：控制台拿到密码的唯一入口。
 *
 * 单独开一个接口，而不是把密码拼成 `login user pass` 命令：命令串会进
 * 本地历史、会在输出区回显、会出现在服务端日志里。密码只在这一条路径上流动，
 * 而且请求体上限只有 512 字节。
 */
export declare function createAuthRoute(options: AuthRouteOptions): (req: Request) => Promise<Response>;
