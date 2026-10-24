import { Hono, type Handler } from "hono";
import type { HonoxEnv } from "./types.js";
export type ApiHandler = Handler<HonoxEnv>;
/**
 * 建一个只有一条路由的子应用，顺手记下它注册在哪（日志里就能指到本文件的行）。
 *
 * 省掉每个接口文件里的例行代码：
 *
 * ```ts
 * // 之前
 * export const botsApi = new Hono();
 * botsApi.get("/bots", apiRoute((c) => { ... }));
 *
 * // 现在
 * export const botsApi = api("/bots", (c) => { ... });
 * ```
 *
 * 只有一条路由时用它；已经有一堆路由的 Hono 实例，用 {@link apiRoute} 单独包。
 */
export declare function api(path: string, handler: ApiHandler, method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"): Hono<HonoxEnv>;
/**
 * 只包 handler（不动路由表）。已有 Hono 实例、或者一条路径挂多个方法时用它。
 */
export declare function apiRoute(handler: ApiHandler): ApiHandler;
//# sourceMappingURL=route.d.ts.map