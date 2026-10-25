import { Hono, type Context, type Handler } from "hono";
import { type ModelClass } from "./model.js";
import type { HonoxEnv } from "./types.js";
/** 登记路由的方法：这些调用各自包一层 handler（与 Hono 的 METHODS + all 对齐）。 */
declare const ROUTE_METHODS: readonly ["get", "post", "put", "delete", "options", "patch", "query", "all"];
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
export type ApiGroup = Hono<HonoxEnv> & Record<(typeof ROUTE_METHODS)[number], RouteMethod>;
/**
 * 建一个 API 组：一个文件一个实例，`module` 是这个文件在生产日志里的身份
 * （打包、压缩后唯一还活着的定位信息，所以必须手写一次；日志行里它当前缀，不进 JSON）。
 *
 * ```ts
 * export const botsApi = createApi("api/bots");
 * botsApi.get("/bots", BotsQuery, (ctx, query) => …);   // GET：解析 query
 * botsApi.post("/bots", BotsBody, (ctx, body) => …);    // POST：解析 body
 * botsApi.get("/health", (ctx) => ctx.json({ ok: true })); // 不校验参数
 * ```
 *
 * 与直接用 `new Hono()` 的区别：登记路由时把 `module` 写进 context，
 * `traceOf(ctx)` 据此给每条日志加模块前缀。
 */
export declare function createApi(module: string): ApiGroup;
/** 只包 handler（不动路由表）：已有 `new Hono()` 实例、或一条路径挂多个方法时用它。 */
export declare function apiRoute(module: string, handler: Handler<HonoxEnv>): Handler<HonoxEnv>;
export {};
//# sourceMappingURL=route.d.ts.map