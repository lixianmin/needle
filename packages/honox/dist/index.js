import { logo } from "@needle/logo";
import { createServerShell } from "@needle/shell";
import { Hono } from "hono";
import { createSnowflake } from "./id.js";
import { installMiddleware } from "./middleware.js";
/**
 * rid 的默认纪元：2014-12-09T00:00:00Z。
 *
 * 写 ISO 串而不是 `Date.UTC(2014, 12, 9)`：后者月份是 0-based，字面值其实是
 * 2015-01-09，差一个月——epoch 是写死的常量，写错了改回来就是 id 字典序断档。
 * 生产建议显式传自己的 epoch。
 */
const DEFAULT_EPOCH = Date.parse("2014-12-09T00:00:00Z");
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
    // 中间件链（rid → 请求日志 → JWT → 门禁）全在 middleware.ts，顺序由库固定。
    installMiddleware(app, {
        log,
        auth: options.auth,
        ids: createSnowflake(options.snowflake ?? { epoch: DEFAULT_EPOCH, nodeId: 0 }),
        public: publicEntries,
    });
    if (shell !== null && shellBasePath !== null) {
        const handle = (c) => shell.handler(c.req.raw);
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
export { createSnowflake, parseSnowflake } from "./id.js";
