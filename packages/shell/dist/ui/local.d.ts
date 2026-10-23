import type { ShellSource } from "../source.js";
import type { ShellAdapter } from "./adapter.js";
/**
 * 进程内适配器：浏览器页面、Chrome 扩展里用这个。
 *
 * 没有 HTTP，没有 token —— 代码本来就跑在你的应用里，能看到控制台就等于
 * 能看到这个进程。鉴权在这一层没有意义，所以 source 用本地用户模式创建。
 */
export declare function createLocalAdapter(source: ShellSource): ShellAdapter;
