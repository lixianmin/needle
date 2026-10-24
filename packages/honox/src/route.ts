import { captureCallSite } from "@needle/logo";
import { Hono, type Context, type Handler } from "hono";
import { modelSchema, type ModelClass } from "./model.js";
import { parseBody, parseQuery } from "./parse.js";
import type { HonoxEnv } from "./types.js";

/** 位置：这个路由注册在哪个文件:行，属于哪个模块。请求日志用它当 `module` / `site` / `fn`。 */
type Origin = { module: string; site?: string; fn?: string };

/** 登记路由的方法：这些调用要抓注册位置。 */
const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all"] as const;
const ROUTE_METHOD_SET = new Set<string>(ROUTE_METHODS);

/** 这些方法读 query，其余读 body。约定：一个路由只校验一侧参数。 */
const QUERY_METHODS = new Set(["get", "delete"]);

/** 解析过参数的 handler：第二个参数是模型实例形状的对象。 */
export type ParsedHandler<T> = (c: Context<HonoxEnv>, request: T) => Response | Promise<Response>;

/** 不解析参数的 handler 类型（与 Hono 的 Handler 一致，单拎出来给业务标注用）。 */
export type ApiHandler = Handler<HonoxEnv>;

type RouteMethod = {
  <T>(path: string, model: ModelClass<T>, handler: ParsedHandler<T>): ApiGroup;
  (path: string, handler: Handler<HonoxEnv>): ApiGroup;
};

/**
 * `createApi()` 的返回值：仍是 Hono（`app.route("/", botsApi)` 照常挂载），
 * 只是登记路由的六个方法各多了一种「带模型」的写法。
 */
export type ApiGroup = Hono<HonoxEnv> &
  Record<(typeof ROUTE_METHODS)[number], RouteMethod>;

function withOrigin(handler: Handler<HonoxEnv>, origin: Origin): Handler<HonoxEnv> {
  return (c, next) => {
    c.set("api", origin);
    return handler(c, next);
  };
}

/**
 * 带模型的 handler：先按方法解析一侧参数，再交给业务。
 *
 * 解析失败抛 `RequestError`，交给 app 的 `onError` 映射成 4xx——不在路由层
 * 构造响应，错误出口只有一个。
 */
function withModel<T>(
  origin: Origin,
  method: string,
  model: ModelClass<T>,
  handler: ParsedHandler<T>,
): Handler<HonoxEnv> {
  const readsQuery = QUERY_METHODS.has(method);
  return async (c) => {
    c.set("api", origin);
    const schema = modelSchema(model);
    const request = readsQuery ? parseQuery(c, schema) : await parseBody(c, schema);
    return handler(c, request as T);
  };
}

/**
 * 建一个 API 组：一个文件一个实例，`module` 是这个文件在生产日志里的身份
 * （打包、压缩后唯一还活着的定位信息，所以必须手写一次）。
 *
 * ```ts
 * export const botsApi = createApi("api/bots");
 * botsApi.get("/bots", BotsQuery, (ctx, query) => …);   // GET：解析 query
 * botsApi.post("/bots", BotsBody, (ctx, body) => …);    // POST：解析 body
 * botsApi.get("/health", (ctx) => ctx.json({ ok: true })); // 不校验参数
 * ```
 *
 * 与直接用 `new Hono()` 的区别：登记路由时抓下「文件:行」，`module` 写进 context。
 */
export function createApi(module: string): ApiGroup {
  const app = new Hono<HonoxEnv>();

  return new Proxy(app, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && ROUTE_METHOD_SET.has(prop)) {
        return (path: string, second: unknown, third?: unknown) => {
          // 第 0 帧是这个箭头函数（route.ts），第 1 帧是调用方（接口文件）。
          const origin: Origin = { module, ...captureCallSite(1) };
          const handler =
            typeof third === "function"
              ? withModel(origin, prop, second as ModelClass<unknown>, third as ParsedHandler<unknown>)
              : withOrigin(second as Handler<HonoxEnv>, origin);
          (target as unknown as Record<string, (p: string, h: Handler<HonoxEnv>) => void>)[prop]?.(
            path,
            handler,
          );
          // 返回代理而不是 target：链式 `.get(...).post(...)` 后续调用也要被包住。
          return receiver;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      // 只绑原型方法。实例自有字段（errorHandler / notFoundHandler）bind 出来是另一个
      // 函数：父 app 的 route() 会据此误判「子 app 自带错误处理」，把 handler 包进子 app
      // 的**默认** errorHandler——父层 onError 就再也收不到这个组的异常。
      return Object.prototype.hasOwnProperty.call(target, prop) ? value : value.bind(target);
    },
  }) as unknown as ApiGroup;
}

/** 只包 handler（不动路由表）：已有 `new Hono()` 实例、或一条路径挂多个方法时用它。 */
export function apiRoute(module: string, handler: Handler<HonoxEnv>): Handler<HonoxEnv> {
  // 第 0 帧是 apiRoute 自己。
  return withOrigin(handler, { module, ...captureCallSite(1) });
}
