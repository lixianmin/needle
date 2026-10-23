import type { ShellAdapter } from "./adapter.js";
export interface ShellView {
    dispose(): void;
}
/**
 * 把控制台挂到一个 DOM 节点上。
 *
 * 用 DOM API 而不是 innerHTML：日志内容是外部数据，拼字符串就得自己防注入；
 * 更重要的是 Chrome 扩展的 CSP 不允许内联脚本，DOM 构建这条路在哪都能走。
 */
export declare function mountShell(root: HTMLElement, adapter: ShellAdapter): ShellView;
