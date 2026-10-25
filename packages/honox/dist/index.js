import { logo } from "@needle/logo";
import { ResponseX, createServerShell } from "@needle/shell";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { installMiddleware } from "./middleware.js";
import { isRequestError } from "./request.js";
/** HTTPException 的状态码 → 错误 code。表里没有的用 `http_error`，别现编。 */
const STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    413: "payload_too_large",
    422: "unprocessable_entity",
    429: "too_many_requests",
    500: "internal_error",
    503: "service_unavailable",
    504: "gateway_timeout",
};
function codeForStatus(status) {
    return STATUS_CODES[status] ?? "http_error";
}
function normalizeBasePath(basePath) {
    const trimmed = basePath.replace(/\/+$/, "");
    // Stryker disable next-line ConditionalExpression,StringLiteral: trimmed 为空时两侧同值（只有全是斜杠的输入会到这里），换任何写法都测不出差别
    return trimmed === "" ? "" : trimmed;
}
/**
 * 装配一个 Hono app：建实例 → 装中间件链（见 middleware.ts）→ 挂 Shell 面板。
 *
 * 业务路由挂在返回值上，所以自动继承中间件链。
 */
export function createHonox(options) {
    const logger = options.logger ?? logo;
    const app = new Hono();
    const shellBasePath = options.shell === undefined ? null : normalizeBasePath(options.shell.basePath ?? "/shell");
    if (shellBasePath === "") {
        // 挂到根路径等于把整站写进白名单——这种配置错误必须在启动时炸，不能默默放行。
        throw new Error("shell.basePath 不能是根路径：请挂到 /shell 这类子路径");
    }
    const shell = 
    // Stryker disable next-line ConditionalExpression,LogicalOperator: shellBasePath 为 null 与没传 shell 等价，子条件构不成独立分支
    options.shell === undefined || shellBasePath === null
        ? null
        : createServerShell({ ...options.shell, basePath: shellBasePath });
    const publicEntries = 
    // Stryker disable next-line ArrayDeclaration: 没配 shell 时白名单本来就该为空，多塞一条不可达路径看不出差别（除非真去请求那个字符串）
    shellBasePath === null ? [] : [shellBasePath, `${shellBasePath}/*`];
    // 中间件链（rid → 兜底日志 → JWT → 门禁）全在 middleware.ts，顺序由库固定。
    installMiddleware(app, {
        logger,
        auth: options.auth,
        public: publicEntries,
        slowMs: options.slowMs,
    });
    // 没命中任何路由：业务补不了，库记。
    app.notFound((ctx) => {
        logger.info({
            rid: ctx.get("rid"),
            path: ctx.req.path,
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
        // HTTPException，它自带状态码。一律当 500 会把 401 变成 500；但也不能直接用
        // `getResponse()`——message-only 的 HTTPException 会吐出 text/plain，破坏
        // `{code, message}` 契约。所以：自定义响应优先，其余套同一套信封。
        if (error instanceof HTTPException) {
            if (error.res !== undefined) {
                return error.res;
            }
            const message = error.status >= 500 ? "服务内部错误" : error.message;
            return ResponseX.fail(error.status, codeForStatus(error.status), message);
        }
        return ResponseX.internalError("服务内部错误");
    });
    // Stryker disable next-line ConditionalExpression,LogicalOperator: shell 与 shellBasePath 总是同时为 null（上面同一行推导），改运算符不产生新分支
    if (shell !== null && shellBasePath !== null) {
        const handle = async (ctx) => {
            const res = await shell.handler(ctx.req.raw);
            // 面板不在 Hono 的路由表里，未命中的 404 由 shell 自己回——不在这里记，
            // 这条路径就一条日志都没有（而它恰好是唯一允许匿名访问的子树）。
            if (res.status === 404) {
                logger.info({ rid: ctx.get("rid"), path: ctx.req.path, status: 404 });
            }
            return res;
        };
        // Stryker disable next-line CallExpression: `/shell/*` 已经匹配 `/shell`（通配吃空段），这行只为了把两条挂载写清楚
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
