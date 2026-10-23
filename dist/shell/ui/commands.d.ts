import type { CommandInfo, ShellUiState, TopicInfo } from "./state.js";
/** 本地命令要用的东西：状态、写输出的口子、订阅改动、密码模式。 */
export interface LocalCommandContext {
    state: ShellUiState;
    pushText(text: string, className?: string): void;
    applySubscriptions(): void;
    enterPasswordMode(user: string): void;
}
/**
 * 本地命令：不发 /exec，因为它们要么属于这条连接，要么属于浏览器。
 *
 * 返回 true 表示这条命令已经处理完了，调用方不要再发服务端。
 */
export declare function runLocal(name: string, args: string[], ctx: LocalCommandContext): boolean;
export declare function commonPrefix(values: string[]): string;
export declare function commandNames(prefix: string, commands: CommandInfo[]): string[];
export declare function topicNames(prefix: string, topics: TopicInfo[]): string[];
/**
 * Tab 补全。
 *
 * 只看行尾补全（控制台里 Tab 基本都在行尾按），这样不用跟 selectionStart
 * 的浏览器差异打交道。命令名来自服务端的 handshake，所以用户在服务器上
 * 自定义的命令一样能被补全；`sub`/`unsub` 的第二个词补主题名。
 */
export declare function complete(input: HTMLInputElement, options: {
    commands: CommandInfo[];
    topics: TopicInfo[];
    pushText(text: string, className?: string): void;
}): void;
