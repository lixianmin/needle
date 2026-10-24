import type { ShellAdapter } from "./adapter.js";
export interface ShellView {
    dispose(): void;
}
/**
 * 把 Shell 挂到一个 DOM 节点上。
 *
 * 用 DOM API 而不是 innerHTML：日志内容是外部数据，拼字符串就得自己防注入；
 * 更重要的是 Chrome 扩展的 CSP 不允许内联脚本，DOM 构建这条路在哪都能走。
 *
 * 这个函数只负责「拼 DOM + 接线」：各块行为都在同目录的小模块里
 * （layout / lines / table / output / commands / input），改一处不用读全文。
 */
export declare function mountShell(root: HTMLElement, adapter: ShellAdapter): ShellView;
