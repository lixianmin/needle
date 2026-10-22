import type { Console } from "../console/index.js";
import { type RunningServer, type ServeOptions } from "../node/serve.js";
/**
 * Hono 适配层。
 *
 * 刻意**不 import hono**：这里只用到它的两个结构特征——`all(path, handler)` 注册路由、
 * `fetch(request)` 处理请求。用结构类型约束即可，于是：
 *   - 本项目不把 hono 变成依赖（Demo 不装 Hono 照样跑）；
 *   - 装没装 Hono、装的哪个版本，都不会让 needle 编译不过。
 */
export interface HonoLike {
    fetch(request: Request, ...rest: never[]): Response | Promise<Response>;
}
export interface HonoRouterLike {
    all(path: string, handler: (context: HonoContextLike) => Response | Promise<Response>): void;
}
/** Hono 的 Context 里我们只用 `req.raw`（原始 Request）。 */
export interface HonoContextLike {
    req: {
        raw: Request;
    };
}
export interface MountConsoleOptions {
    /** 挂载前缀，如 "/console"。 */
    basePath?: string;
}
/**
 * 把调试控制台挂到 Hono 应用上。
 *
 * 控制台自己认 basePath（内部剥前缀），所以这里只把前后缀两条路径都指向同一个
 * handler：`/console` 与 `/console/*` 各一条，省得漏掉结尾没有斜杠的那次访问。
 */
export declare function mountConsole(app: HonoRouterLike, console: Console, options?: MountConsoleOptions): void;
/**
 * 用 needle 的 node:http 适配器把 Hono 应用跑起来。
 *
 * 这样运行时不再绑死：同一份代码在 Node 与 Bun 上都能起。
 */
export declare function serveHono(app: HonoLike, options: ServeOptions): Promise<RunningServer>;
