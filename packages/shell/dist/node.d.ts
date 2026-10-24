import { type Server } from "node:http";
export interface ServeOptions {
    port: number;
    hostname?: string;
}
export interface AttachOptions {
    /**Shell 挂载前缀，如 "/shell"；省略表示接管全部请求。 */
    basePath?: string;
}
/** 只要求一个 Fetch 形态的 handler，避免把 shell 包的类型拖进 node 入口。 */
export interface ShellLike {
    handler(req: Request): Promise<Response>;
}
export interface RunningServer {
    port: number;
    close(): Promise<void>;
}
/**
 * 把 `(Request) => Response` 挂到一个 node:http 服务上。
 *
 * 库不依赖 Hono/Express：它们能做这件事，但为了挂四五条路由引入一个框架
 * 不划算。这里只做转换，路由在 handler 里。
 */
export declare function serve(handler: (req: Request) => Promise<Response>, options: ServeOptions): Promise<RunningServer>;
/**
 * 把 Shell 挂到一个已经在跑的 node:http 服务上（裸 Node、Express、Fastify 底层都是它）。
 *
 * 做法是接管 `request` 事件：Shell 前缀内的请求交给 Fetch handler，前缀外按注册
 * 顺序原样交回给原来的 listener——所以已经挂好的 app 一行都不用改。
 *
 * 注意语义：Shell 在原来的路由/中间件**之前**处理自己的路径，不经过它们（也不受
 * 它们的 body 解析、鉴权中间件影响）。这正是 Shell 要的：它自己的 /exec 和 /events
 * 有独立的鉴权。
 */
export declare function attach(server: Server, target: ShellLike, options?: AttachOptions): void;
//# sourceMappingURL=node.d.ts.map