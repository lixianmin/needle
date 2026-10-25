import { Hono, type Context, type Handler } from "hono";
import { modelSchema, type ModelClass } from "./model.js";
import { parseBody, parseQuery } from "./parse.js";
import type { HonoxEnv } from "./types.js";

/** 登记路由的方法：这些调用各自包一层 handler（与 Hono 的 METHODS + all 对齐）。 */
const ROUTE_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "options",
  "patch",
  "query",
  "all",
] as const;
const ROUTE_METHOD_SET = new Set<string>(ROUTE_METHODS);

/** 返回 `this` 的链式方法：要把 `this` 换回代理，否则后续登记绕过包装。 */
const CHAINING_METHODS = new Set<string | symbol>(["use", "on", "route", "mount"]);

/** 这些方法读 query，其余读 body。约定：一个路由只校验一侧参数。 */
const QUERY_METHODS = new Set(["get", "delete", "options", "query"]);

/**
 * 模型类（class）与普通 handler 在运行时只差一个特征：class 的 `prototype` 是
 * **不可写**的（ES 规范如此），普通 function 声明/表达式的 `prototype` 可写。
 *
 * 不能只看 `prototype !== undefined`：function 声明也有 prototype，
 * `api.get(path, function auth() {}, handler)` 会被误判成带模型的写法，
 * 然后整条路由 500（「没有为 auth 注册 schema」）。
 *
 * 前提是 class 没有被降级成 function（编译目标 es2015+）。降级之后这个判据
 * 失效，带模型的写法会被当成 handler 链——所以不要给 bean 用 es5 目标。
 */
function isModelClass(value: unknown): value is ModelClass<unknown> {
  if (typeof value !== "function") {
    return false;
  }

  return Object.getOwnPropertyDescriptor(value, "prototype")?.writable === false;
}

/** 解析过参数的 handler：第二个参数是模型实例形状的对象。 */
export type ParsedHandler<T> = (ctx: Context<HonoxEnv>, request: T) => Response | Promise<Response>;

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

function withOrigin(handler: Handler<HonoxEnv>, logModule: string): Handler<HonoxEnv> {
  return (ctx, next) => {
    ctx.set("api", { module: logModule });
    return handler(ctx, next);
  };
}

/**
 * 带模型的 handler：先按方法解析一侧参数，再交给业务。
 *
 * 解析失败抛 `RequestError`，交给 app 的 `onError` 映射成 4xx——不在路由层
 * 构造响应，错误出口只有一个。
 */
function withModel<T>(
  logModule: string,
  method: string,
  model: ModelClass<T>,
  handler: ParsedHandler<T>,
): Handler<HonoxEnv> {
  const readsQuery = QUERY_METHODS.has(method);
  return async (ctx) => {
    ctx.set("api", { module: logModule });
    const schema = modelSchema(model);
    const request = readsQuery ? parseQuery(ctx, schema) : await parseBody(ctx, schema);
    return handler(ctx, request as T);
  };
}

/**
 * 建一个 API 组：一个文件一个实例。`logModule` 是**源文件名**（带扩展名，如 `bots.ts`），
 * 写进日志前缀，回答「这条日志是哪个文件打的」。它和路由路径没有任何关系——挂载点由
 * 调用方的 `.route()` / `.basePath()` 决定，两者不同步也不该同步。
 *
 * 为什么是手写字符串：打包压缩后栈里只剩 bundle 坐标，文件名是唯一还活着的定位信息。
 *
 * ```ts
 * export const botsApi = createApi("bots.ts");
 * botsApi.get("/bots", BotsQuery, (ctx, query) => …);   // GET：解析 query
 * botsApi.post("/bots", BotsBody, (ctx, body) => …);    // POST：解析 body
 * botsApi.get("/health", (ctx) => ctx.json({ ok: true })); // 不校验参数
 * ```
 *
 * 与直接用 `new Hono()` 的区别：登记路由时把文件名写进 context，
 * `traceOf(ctx)` 据此给每条日志加前缀。
 */
export function createApi(logModule: string): ApiGroup {
  const app = new Hono<HonoxEnv>();

  return new Proxy(app, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && ROUTE_METHOD_SET.has(prop)) {
        // 用 rest：Hono 自己支持一条路径挂多个 handler，写死 second/third 会把
        // 第三个之后的 handler 悄悄丢掉（路由变成 404，注册期毫无提示）。
        return (path: string, ...args: unknown[]) => {
          // Hono 还允许不带路径的 `get(handler)`（沿用上一次的 path）；createApi
          // 不支持它——那种写法抓不到「这条路由注册在哪」，模块身份也就丢了。
          if (typeof path !== "string") {
            throw new Error(`createApi 的路由必须带路径：${prop}("/path", handler)`);
          }

          // 第 0 帧是这个箭头函数（route.ts），不再抓注册行：打包后栈里只剩
          // bundle 坐标，定位靠 `module`（日志前缀）。
          const withModelForm =
            args.length === 2 && typeof args[1] === "function" && isModelClass(args[0]);
          if (withModelForm && prop === "all") {
            throw new Error(
              `all ${path}：all 会按 body 解析参数，GET 之类没有 body 的请求必然 400；请分开写具体方法`,
            );
          }

          if (!withModelForm && args.some(isModelClass)) {
            throw new Error(
              `${prop} ${path}：带模型的写法只支持 (path, Model, handler)，模型不能出现在 handler 位置`,
            );
          }

          const handlers: Handler<HonoxEnv>[] = withModelForm
            ? [withModel(logModule, prop, args[0] as ModelClass<unknown>, args[1] as ParsedHandler<unknown>)]
            : args
                .filter((entry): entry is Handler<HonoxEnv> => typeof entry === "function")
                .map((entry) => withOrigin(entry, logModule));
          const register = (
            target as unknown as Record<string, (p: string, ...h: Handler<HonoxEnv>[]) => void>
          )[prop];
          register?.call(target, path, ...handlers);
          // 返回代理而不是 target：链式 `.get(...).post(...)` 后续调用也要被包住。
          return receiver;
        };
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }

      // 这几个方法 `return this`（= target）。链式 `api.use(...).get(...)` 的那次
      // .get 如果拿到裸 target，就不会包 handler，日志里连 module 都没有。
      if (CHAINING_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const result = (value as (...rest: unknown[]) => unknown).apply(target, args);
          return result === target ? receiver : result;
        };
      }

      // 只绑原型方法。实例自有字段（errorHandler / notFoundHandler）bind 出来是另一个
      // 函数：父 app 的 route() 会据此误判「子 app 自带错误处理」，把 handler 包进子 app
      // 的**默认** errorHandler——父层 onError 就再也收不到这个组的异常。
      return Object.prototype.hasOwnProperty.call(target, prop) ? value : value.bind(target);
    },
  }) as unknown as ApiGroup;
}

/** 只包 handler（不动路由表）：已有 `new Hono()` 实例、或一条路径挂多个方法时用它。 */
export function apiRoute(logModule: string, handler: Handler<HonoxEnv>): Handler<HonoxEnv> {
  return withOrigin(handler, logModule);
}
