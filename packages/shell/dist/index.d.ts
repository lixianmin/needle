import { type ShellSource, type ShellSourceOptions } from "./source.js";
import { type ShellView } from "./ui/view.js";
export interface ShellOptions extends ShellSourceOptions {
    /** 挂载前缀，如 "/shell"。默认挂在根路径。 */
    basePath?: string;
    /** 页面默认订阅的主题，如 "top:5000"。 */
    topicSpec?: string;
}
export interface Shell {
    handler(req: Request): Promise<Response>;
    source: ShellSource;
    dispose(): void;
}
/**
 * 服务端的控制台：一个 `(Request) => Response`。
 *
 * 只做三件事：剥掉 basePath、按路径分派、把 token 换成用户身份。命令怎么执行、
 * 日志怎么推，全在 source 里——同一段逻辑浏览器里也在用。
 */
export declare function createShell(options: ShellOptions): Shell;
/**
 * 浏览器页面 / 扩展里的控制台：把面板挂到一个 DOM 节点上。
 *
 * 与 createShell 用同一个 source，区别只是没有 HTTP：命令直调，
 * 日志通过 broadcast 直接流到面板。
 */
export declare function createBrowserShell(options: ShellSourceOptions & {
    element: HTMLElement;
}): {
    source: ShellSource;
    view: ShellView;
    dispose(): void;
};
export { createShellSource } from "./source.js";
export { table } from "./table.js";
export type { Column, TableOutput } from "./table.js";
export { mountShell } from "./ui/view.js";
export { createLocalAdapter } from "./ui/local.js";
export { createFetchAdapter } from "./ui/fetch-adapter.js";
export type { ShellSource, ShellSourceOptions, ExecResult } from "./source.js";
export type { ShellAdapter, ShellEvent, HandshakeInfo, AuthResult } from "./ui/adapter.js";
export type { AuthOptions, Command, CommandContext, CommandOutput, Topic } from "./types.js";
