import type { ShellAdapter } from "./adapter.js";
import type { OutputSink } from "./output.js";
import type { ShellUiState } from "./state.js";
import type { TableRenderer } from "./table.js";
/** 输入区（表单 + 键盘）需要的东西。 */
export interface InputContext {
    input: HTMLInputElement;
    form: HTMLFormElement;
    adapter: ShellAdapter;
    sink: OutputSink;
    table: TableRenderer;
    state: ShellUiState;
    applySubscriptions(): void;
}
export declare function enterPasswordMode(ctx: InputContext, user: string): void;
export declare function leavePasswordMode(ctx: InputContext): void;
/** 表单提交：要么是密码，要么是一条命令。 */
export declare function wireForm(ctx: InputContext): void;
/** 输入框的键盘：Esc 取消密码、Tab 补全、上下翻历史。 */
export declare function wireKeys(ctx: InputContext): void;
/**
 * 回车抢焦点。
 *
 * 控制台的用法是"随时开始敲命令"，而不是"先精确点中那个输入框"。焦点在
 * 页面空白处或输出区时按回车，直接把光标送进输入框——省掉一次鼠标移动。
 * 焦点已经在别的输入控件里（页面里可能嵌着业务表单）就不抢。
 */
export declare function wireEnterFocus(doc: Document, input: HTMLInputElement): () => void;
