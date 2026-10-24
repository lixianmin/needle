import { logo } from "@needle/logo";
import { createServerShell } from "@needle/shell";
import { Hono } from "hono";
import { createSnowflake } from "./id.js";
import { installMiddleware } from "./middleware.js";
/** rid 的默认纪元：2026-01-01T00:00:00Z。生产建议显式传自己的 epoch。 */
const DEFAULT_EPOCH = Date.UTC(2026, 0, 1);
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
    const log = options.log ?? logo;
    const app = new Hono();
    const shellBasePath = options.shell === undefined ? null : normalizeBasePath(options.shell.basePath ?? "/shell");
    if (shellBasePath === "") {
        // 挂到根路径等于把整站写进白名单——这种配置错误必须在启动时炸，不能默默放行。
        throw new Error("shell.basePath 不能是根路径：请挂到 /shell 这类子路径");
    }
    const shell = options.shell === undefined || shellBasePath === null
        ? null
        : createServerShell({ ...options.shell, basePath: shellBasePath });
    const publicEntries = [
        ...(options.auth.public ?? []),
        ...(shellBasePath === null ? [] : [shellBasePath, `${shellBasePath}/*`]),
    ];
    // 中间件链（rid → 请求日志 → JWT → 门禁）全在 middleware.ts，顺序由库固定。
    installMiddleware(app, {
        log,
        auth: options.auth,
        ids: createSnowflake(options.id ?? { epoch: DEFAULT_EPOCH, nodeId: 0 }),
        public: publicEntries,
    });
    if (shell !== null && shellBasePath !== null) {
        const handle = (c) => shell.handler(c.req.raw);
        app.all(shellBasePath, handle);
        app.all(`${shellBasePath}/*`, handle);
    }
    return app;
}
export { apiRoute } from "./middleware.js";
export { createSnowflake, parseSnowflake } from "./id.js";
