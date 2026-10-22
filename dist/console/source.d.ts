import type { Logger } from "../core/logo/logo.js";
import { type Auth } from "./auth.js";
import { type Broadcast } from "./sse.js";
import type { AuthOptions, Command, CommandOutput, LogFiles, Topic } from "./types.js";
/**
 * 命令执行结果。
 *
 * `unauthorized` 单独标出来，是为了让 HTTP 适配器能把它映射成 401——
 * 纯逻辑层不该知道状态码，但调用方需要区分"没登录"和"命令报错"。
 */
export type ExecResult = {
    ok: true;
    output: CommandOutput;
} | {
    ok: false;
    error: string;
    unauthorized?: true;
};
export interface ConsoleSourceOptions {
    logger: Logger;
    auth: AuthOptions;
    commands?: Command[];
    topics?: Topic[];
    /** 头栏显示的项目名，默认 "console"。 */
    title?: string;
    version?: string;
    /**
     * 本地身份。设了它就跳过 token 鉴权——浏览器页面和扩展里，能看到控制台
     * 的人本来就能碰到这个进程，再要一次 token 只是仪式。
     */
    user?: string;
    /** 日志目录端口。Node 侧用 createLogFiles 提供；浏览器/Workers 不传。 */
    logFiles?: LogFiles;
    /** 拼日志文件链接的前缀，如 "/console"。 */
    basePath?: string;
    timeoutMs?: number;
}
/**
 * 控制台的全部逻辑，不含任何传输层。
 *
 * 它是 Node 服务、Workers、浏览器页面、Chrome 扩展共用的那一层：
 * 同一个 source 上面可以挂 HTTP/SSE 适配器，也可以直接挂 DOM。
 */
export interface ConsoleSource {
    commands: readonly Command[];
    topics: readonly Topic[];
    broadcast: Broadcast;
    logFiles?: LogFiles;
    auth: Auth;
    title: string;
    version: string;
    /** 本地身份；服务端模式为 null。 */
    user: string | null;
    exec(line: string, token: string | null): Promise<ExecResult>;
    /** 校验口令并签发 token。密码不走命令行，所以单独开一个入口。 */
    authenticate(user: string, password: string): Promise<AuthResult>;
    dispose(): void;
}
export type AuthResult = {
    ok: true;
    user: string;
    token: string;
} | {
    ok: false;
    error: string;
};
export declare function createConsoleSource(options: ConsoleSourceOptions): ConsoleSource;
