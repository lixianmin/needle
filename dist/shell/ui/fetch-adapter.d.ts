import type { ShellAdapter } from "./adapter.js";
interface FetchAdapterOptions {
    /** 控制台挂载前缀，如 "/shell"。空字符串表示挂在根路径。 */
    basePath: string;
    /** SSE 的 topics 参数，如 "top:5000,mem"。 */
    topics?: string;
}
/**
 * 面向 HTTP/SSE 的适配器：给服务器托管的那个页面用。
 *
 * 不用原生 EventSource，因为它不能带 Authorization 头。自己读流多写十几行，
 * 换来的是 token 能放在头里而不是 URL 里（URL 会进访问日志）。
 */
export declare function createFetchAdapter(options: FetchAdapterOptions): ShellAdapter;
export {};
