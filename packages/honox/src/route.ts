import { captureCallSite } from "@needle/logo";
import { Hono, type Handler } from "hono";
import type { HonoxEnv } from "./types.js";

export type ApiHandler = Handler<HonoxEnv>;

/** 位置：这个 API 注册在哪个文件:行。请求日志用它当 `site` / `fn`。 */
type Origin = { site: string; fn: string };

/**
 * 包一层 handler，把注册位置写进 context。
 *
 * 日志是在中间件里打的，那一刻 handler 不在栈上（进时没跑、出时已返回），所以
 * 位置只能在注册时抓一次。
 */
function withOrigin(handler: ApiHandler, origin: Origin | undefined): ApiHandler {
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
export function api(
  path: string,
  handler: ApiHandler,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
): Hono<HonoxEnv> {
  // 跳 1 帧：第 0 帧是 api() 自己，第 1 帧才是调用它的接口文件。
  const origin = captureCallSite(1);
  const app = new Hono<HonoxEnv>();

  const route = method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  app[route](path, withOrigin(handler, origin));
  return app;
}

/**
 * 只包 handler（不动路由表）。已有 Hono 实例、或者一条路径挂多个方法时用它。
 */
export function apiRoute(handler: ApiHandler): ApiHandler {
  // 跳 1 帧：第 0 帧是 apiRoute 自己。
  return withOrigin(handler, captureCallSite(1));
}
