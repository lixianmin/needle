import { type Logger } from "@needle/logo";
import { type Auth } from "./auth.js";
import { type Broadcast } from "./sse.js";
import type { LogFiles } from "@needle/logo";
import type { AuthOptions, Command, CommandOutput, Topic } from "./types.js";
/**
 * 命令失败的原因。HTTP 适配器拿它选状态码；浏览器适配器只关心 unauthorized。
 */
export type ExecFailureCode = "disposed" | "bad_request" | "unknown_command" | "unauthorized" | "timeout" | "command_failed";
/**
 * 命令执行结果。
 *
 * 纯逻辑层不碰状态码（浏览器里没有状态码），所以失败带的是 `code`，由适配器
 * 自己映射：HTTP 适配器转成状态码 + `{code, message}`，浏览器适配器转成提示。
 */
export type ExecResult = {
    ok: true;
    output: CommandOutput;
} | {
    ok: false;
    code: ExecFailureCode;
    error: string;
};
export interface ShellSourceOptions {
    /**
     * 日志来源。默认用 `@needle/logo` 的全局 `logo` 实例——全项目写同一个 logger 时，
     * 右栏自然接管所有日志，不用一层层往下传。测试或需要独立配置时传自己的实例。
     */
    logger?: Logger;
    auth: AuthOptions;
    commands?: Command[];
    topics?: Topic[];
    /** 头栏显示的项目名，默认 "shell"。 */
    title?: string;
    version?: string;
    /**
     * 本地身份。设了它就跳过 token 鉴权——浏览器页面和扩展里，能看到 Shell
     * 的人本来就能碰到这个进程，再要一次 token 只是仪式。
     */
    user?: string;
    /** 日志目录端口。Node 侧用 createLogFiles 提供；浏览器/Workers 不传。 */
    logFiles?: LogFiles;
    /** 拼日志文件链接的前缀，如 "/shell"。 */
    basePath?: string;
    timeoutMs?: number;
}
/**
 *Shell 的全部逻辑，不含任何传输层。
 *
 * 它是 Node 服务、Workers、浏览器页面、Chrome 扩展共用的那一层：
 * 同一个 source 上面可以挂 HTTP/SSE 适配器，也可以直接挂 DOM。
 */
export interface ShellSource {
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
export declare function createShellSource(options: ShellSourceOptions): ShellSource;
//# sourceMappingURL=source.d.ts.map