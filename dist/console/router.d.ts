/**
 * 路由表：method + 路径模式 → handler。
 *
 * 控制台的端点就这几条（spec §8.2 那张表），写成数据比一串 `if` 更容易核对。
 * 模式里的 `:name` 占一个路径段：`/log/<name>` 写作 `/log/:name`。
 */
export interface RouteContext {
    req: Request;
    url: URL;
    /** 模式里解出的参数；没有参数时是空对象。 */
    params: Record<string, string>;
}
export type RouteHandler = (ctx: RouteContext) => Response | Promise<Response>;
export interface Route {
    method: string;
    pattern: string;
    handler: RouteHandler;
}
export interface RouteMatch {
    url: URL;
    params: Record<string, string>;
    handler: RouteHandler;
}
export interface Router {
    /** 路径不在 basePath 内、或没有 method + 路径都匹配的条目时返回 null。 */
    match(req: Request): RouteMatch | null;
}
/** `"console"` → `"/console"`，`"/console/"` → `"/console"`，`""` 与 `"/"` → `""`。 */
export declare function normalizeBasePath(value: string): string;
export declare function createRouter(options: {
    basePath?: string;
    routes: Route[];
}): Router;
