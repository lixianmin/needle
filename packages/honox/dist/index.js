import { logo } from "@needle/logo";
import { createServerShell } from "@needle/shell";
import { Hono } from "hono";
import { createAuth } from "./auth.js";
import { createRequestLog } from "./request-log.js";
function normalizeBasePath(basePath) {
    const trimmed = basePath.replace(/\/+$/, "");
    return trimmed === "" ? "" : trimmed;
}
/**
 * 装配一个 Hono app：reqId → 请求日志 → JWT → 门禁，顺序由库固定。
 *
 * 顺序不能交给业务：日志排在门禁前面，401 才有结束行；JWT 排在门禁前面，
 * 门禁才看得到 uid。这两个顺序错一个，症状都很隐蔽（"日志偶尔少一行"）。
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
    app.use("*", async (c, next) => {
        const reqId = crypto.randomUUID();
        c.set("reqId", reqId);
        c.set("config", options.config);
        c.set("log", log);
        await next();
        c.header("x-request-id", reqId);
    });
    app.use("*", createRequestLog(log));
    app.use("*", createAuth({ ...options.auth, public: publicEntries }));
    if (shell !== null && shellBasePath !== null) {
        const handle = (c) => shell.handler(c.req.raw);
        app.all(shellBasePath, handle);
        app.all(`${shellBasePath}/*`, handle);
    }
    return app;
}
