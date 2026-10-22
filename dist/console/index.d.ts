import { type ConsoleSource, type ConsoleSourceOptions } from "./source.js";
import { type ConsoleView } from "./ui/view.js";
export interface ConsoleOptions extends ConsoleSourceOptions {
    /** 挂载前缀，如 "/console"。默认挂在根路径。 */
    basePath?: string;
    /** 页面默认订阅的主题，如 "top:5000"。 */
    topicSpec?: string;
}
export interface Console {
    handler(req: Request): Promise<Response>;
    source: ConsoleSource;
    dispose(): void;
}
/**
 * 服务端的控制台：一个 `(Request) => Response`。
 *
 * 只做三件事：剥掉 basePath、按路径分派、把 token 换成用户身份。命令怎么执行、
 * 日志怎么推，全在 source 里——同一段逻辑浏览器里也在用。
 */
export declare function createConsole(options: ConsoleOptions): Console;
/**
 * 浏览器页面 / 扩展里的控制台：把面板挂到一个 DOM 节点上。
 *
 * 与 createConsole 用同一个 source，区别只是没有 HTTP：命令直调，
 * 日志通过 broadcast 直接流到面板。
 */
export declare function createBrowserConsole(options: ConsoleSourceOptions & {
    element: HTMLElement;
}): {
    source: ConsoleSource;
    view: ConsoleView;
    dispose(): void;
};
export { createConsoleSource } from "./source.js";
export { mountConsole } from "./ui/view.js";
export { createLocalAdapter } from "./ui/local.js";
export type { ConsoleSource, ConsoleSourceOptions, ExecResult } from "./source.js";
export type { ConsoleAdapter, ConsoleEvent, HandshakeInfo, AuthResult } from "./ui/adapter.js";
export type { AuthOptions, Command, CommandContext, CommandOutput, Topic } from "./types.js";
