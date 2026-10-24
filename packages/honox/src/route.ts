import { captureCallSite } from "@needle/logo";
import { Hono, type Handler } from "hono";
import type { HonoxEnv } from "./types.js";

export type ApiHandler = Handler<HonoxEnv>;

/** 位置：这个路由注册在哪个文件:行。请求日志用它当 `site` / `fn`。 */
type Origin = { site: string; fn: string };

/** 路由注册方法：这些都是"登记一条路由"，注册位置要抓下来。 */
const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all"] as const;
const ROUTE_METHOD_SET = new Set<string>(ROUTE_METHODS);

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
export function createApi(): Hono<HonoxEnv> {
  const app = new Hono<HonoxEnv>();

  return new Proxy(app, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && ROUTE_METHOD_SET.has(prop)) {
        return (path: string, ...handlers: unknown[]) => {
          // 第 0 帧是这个箭头函数（route.ts），第 1 帧是调用方（接口文件）。
          const origin = captureCallSite(1);
          const wrapped = handlers.map((handler) =>
            typeof handler === "function" ? withOrigin(handler as ApiHandler, origin) : handler,
          );
          (target as unknown as Record<string, (p: string, ...h: unknown[]) => unknown>)[prop]?.(
            path,
            ...wrapped,
          );
          // 返回代理而不是 target：链式 `.get(...).post(...)` 后续调用也要被包住。
          return receiver;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * 只包 handler（不动路由表）。已有 `new Hono()` 实例、或者一条路径挂多个方法时用它。
 */
export function apiRoute(handler: ApiHandler): ApiHandler {
  // 第 0 帧是 apiRoute 自己。
  return withOrigin(handler, captureCallSite(1));
}
