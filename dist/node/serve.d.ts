export interface ServeOptions {
    port: number;
    hostname?: string;
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
