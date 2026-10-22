import { serve } from "../node/serve.js";
function normalizeBasePath(value) {
    if (value === undefined || value === "" || value === "/")
        return "";
    const trimmed = value.replace(/\/+$/, "");
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
/**
 * 把调试控制台挂到 Hono 应用上。
 *
 * 控制台自己认 basePath（内部剥前缀），所以这里只把前后缀两条路径都指向同一个
 * handler：`/console` 与 `/console/*` 各一条，省得漏掉结尾没有斜杠的那次访问。
 */
export function mountConsole(app, console, options = {}) {
    const base = normalizeBasePath(options.basePath);
    const paths = base === "" ? ["/", "/*"] : [base, `${base}/*`];
    for (const path of paths) {
        app.all(path, (context) => console.handler(context.req.raw));
    }
}
/**
 * 用 needle 的 node:http 适配器把 Hono 应用跑起来。
 *
 * 这样运行时不再绑死：同一份代码在 Node 与 Bun 上都能起。
 */
export async function serveHono(app, options) {
    return serve((request) => Promise.resolve(app.fetch(request)), options);
}
