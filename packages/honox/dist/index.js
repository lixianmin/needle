import { logo } from "@needle/logo";
import { ResponseX, createServerShell } from "@needle/shell";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { installMiddleware } from "./middleware.js";
import { isRequestError } from "./request.js";
function normalizeBasePath(basePath) {
    const trimmed = basePath.replace(/\/+$/, "");
    return trimmed === "" ? "" : trimmed;
}
/**
 * 装配一个 Hono app：建实例 → 装中间件链（见 middleware.ts）→ 挂 Shell 面板。
 *
 * 业务路由挂在返回值上，所以自动继承中间件链。
 */
export function createHonox(options) {
    const log = options.logger ?? logo;
    const app = new Hono();
    const shellBasePath = options.shell === undefined ? null : normalizeBasePath(options.shell.basePath ?? "/shell");
    if (shellBasePath === "") {
        // 挂到根路径等于把整站写进白名单——这种配置错误必须在启动时炸，不能默默放行。
        throw new Error("shell.basePath 不能是根路径：请挂到 /shell 这类子路径");
    }
    const shell = options.shell === undefined || shellBasePath === null
        ? null
        : createServerShell({ ...options.shell, basePath: shellBasePath });
    const publicEntries = shellBasePath === null ? [] : [shellBasePath, `${shellBasePath}/*`];
    // 中间件链（rid → 兜底日志 → JWT → 门禁）全在 middleware.ts，顺序由库固定。
    installMiddleware(app, {
        log,
        auth: options.auth,
        public: publicEntries,
        slowMs: options.slowMs,
    });
    // 没命中任何路由：业务补不了，库记。
    app.notFound((c) => {
        log.info({
            rid: c.get("rid"),
            method: c.req.method,
            path: c.req.path,
            status: 404,
        });
        return ResponseX.notFound("接口不存在");
    });
    // 只做映射，不记日志——500 的日志由中间件的兜底层统一记（业务替换 onError
    // 也不会丢），这里再记一次就是两条。
    app.onError((error) => {
        if (isRequestError(error)) {
            return ResponseX.fail(error.status, error.code, error.message);
        }
        // Hono 自带的中间件（basic-auth / bearer-auth / zValidator 之类）抛的是
        // HTTPException，它自带状态码与响应体；一律当 500 会把 401 变成 500。
        if (error instanceof HTTPException) {
            return error.getResponse();
        }
        return ResponseX.internalError("服务内部错误");
    });
    if (shell !== null && shellBasePath !== null) {
        const handle = async (c) => {
            const res = await shell.handler(c.req.raw);
            // 面板不在 Hono 的路由表里，未命中的 404 由 shell 自己回——不在这里记，
            // 这条路径就一条日志都没有（而它恰好是唯一允许匿名访问的子树）。
            if (res.status === 404) {
                log.info({ rid: c.get("rid"), method: c.req.method, path: c.req.path, status: 404 });
            }
            return res;
        };
        app.all(shellBasePath, handle);
        app.all(`${shellBasePath}/*`, handle);
    }
    // 门禁持有的是 publicEntries 这个数组的引用，所以这里 append 的条目对
    // 下一个请求就生效，不用重装中间件。
    const honox = app;
    honox.allowAnonymous = (entries) => {
        publicEntries.push(...entries);
        return honox;
    };
    return honox;
}
export { apiRoute, createApi } from "./route.js";
export { RequestError, isRequestError } from "./request.js";
export { traceOf } from "./trace.js";
export { modelSchema, registerModel } from "./model.js";
