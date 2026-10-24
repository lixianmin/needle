import { captureCallSite } from "@needle/logo";
import { Hono } from "hono";
/**
 * 包一层 handler，把注册位置写进 context。
 *
 * 日志是在中间件里打的，那一刻 handler 不在栈上（进时没跑、出时已返回），所以
 * 位置只能在注册时抓一次。
 */
function withOrigin(handler, origin) {
    if (origin === undefined) {
        return handler;
    }
    return (c, next) => {
        c.set("api", origin);
        return handler(c, next);
    };
}
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
export function api(path, handler, method = "GET") {
    // 跳 1 帧：第 0 帧是 api() 自己，第 1 帧才是调用它的接口文件。
    const origin = captureCallSite(1);
    const app = new Hono();
    const route = method.toLowerCase();
    app[route](path, withOrigin(handler, origin));
    return app;
}
/**
 * 只包 handler（不动路由表）。已有 Hono 实例、或者一条路径挂多个方法时用它。
 */
export function apiRoute(handler) {
    // 跳 1 帧：第 0 帧是 apiRoute 自己。
    return withOrigin(handler, captureCallSite(1));
}
