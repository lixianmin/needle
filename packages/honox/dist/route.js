import { captureCallSite } from "@needle/logo";
import { Hono } from "hono";
import { modelSchema } from "./model.js";
import { parseBody, parseQuery } from "./parse.js";
/** 登记路由的方法：这些调用要抓注册位置。 */
const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all"];
const ROUTE_METHOD_SET = new Set(ROUTE_METHODS);
/** 这些方法读 query，其余读 body。约定：一个路由只校验一侧参数。 */
const QUERY_METHODS = new Set(["get", "delete"]);
/**
 * 模型类（class）与普通 handler 在运行时只差一个特征：class 一定有 `prototype`。
 * 不判这个的话，`api.get(path, h1, h2)`（Hono 支持一个路径挂多个 handler）会被
 * 当成 `(path, Model, handler)`，然后拿 h1 的 name 去查 schema，整条路由 500。
 */
function isModelClass(value) {
    return typeof value === "function" && value.prototype !== undefined;
}
function withOrigin(handler, origin) {
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
function withModel(origin, method, model, handler) {
    const readsQuery = QUERY_METHODS.has(method);
    return async (c) => {
        c.set("api", origin);
        const schema = modelSchema(model);
        const request = readsQuery ? parseQuery(c, schema) : await parseBody(c, schema);
        return handler(c, request);
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
export function createApi(module) {
    const app = new Hono();
    return new Proxy(app, {
        get(target, prop, receiver) {
            if (typeof prop === "string" && ROUTE_METHOD_SET.has(prop)) {
                return (path, second, third) => {
                    // 第 0 帧是这个箭头函数（route.ts），第 1 帧是调用方（接口文件）。
                    const origin = { module, ...captureCallSite(1) };
                    const handlers = typeof third === "function" && isModelClass(second)
                        ? [withModel(origin, prop, second, third)]
                        : [second, third]
                            .filter((entry) => typeof entry === "function")
                            .map((entry) => withOrigin(entry, origin));
                    const register = target[prop];
                    register?.(path, ...handlers);
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
    });
}
/** 只包 handler（不动路由表）：已有 `new Hono()` 实例、或一条路径挂多个方法时用它。 */
export function apiRoute(module, handler) {
    // 第 0 帧是 apiRoute 自己。
    return withOrigin(handler, { module, ...captureCallSite(1) });
}
