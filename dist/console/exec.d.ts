import type { ConsoleSource } from "./source.js";
export interface ExecHttpOptions {
    source: ConsoleSource;
    maxBodyBytes?: number;
}
/**
 * `POST /exec` 的处理函数。
 *
 * 这里只做 HTTP 相关的事：限额、解析、状态码映射。命令执行、鉴权、超时
 * 都在 source 里，浏览器里的本地适配器走的是同一段逻辑。
 */
export declare function createExecHandler(options: ExecHttpOptions): (req: Request) => Promise<Response>;
