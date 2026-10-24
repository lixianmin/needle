import { Hono, type Handler } from "hono";
import type { HonoxEnv } from "./types.js";
export type ApiHandler = Handler<HonoxEnv>;
/**
 * 建一个 API 组：一个文件一个实例，里面 `get` / `post` / ... 挂多条路由。
 *
 * ```ts
 * // app/api/bots.ts
 * export const botsApi = createApi();
 *
 * botsApi.get("/bots", (c) => ...);
 * botsApi.post("/bots", (c) => ...);
 * ```
 *
 * 与直接用 `new Hono()` 的区别只有一点：**每次 `get` / `post` 会自动抓下注册处
 * 的「文件:行」**，写进 context 给请求日志用。日志是在中间件里打的，那一刻
 * handler 不在栈上，只能注册时先记下来。
 *
 * 返回值仍是 `Hono`，所以 `app.route("/", botsApi)` 照常挂载。
 */
export declare function createApi(): Hono<HonoxEnv>;
/**
 * 只包 handler（不动路由表）。已有 `new Hono()` 实例、或者一条路径挂多个方法时用它。
 */
export declare function apiRoute(handler: ApiHandler): ApiHandler;
//# sourceMappingURL=route.d.ts.map