/**
 * 路由表：method + 路径模式 → handler。
 *
 * 控制台的端点就这几条（spec §8.2 那张表），写成数据比一串 `if` 更容易核对。
 * 模式里的 `:name` 占一个路径段：`/log/<name>` 写作 `/log/:name`。
 */
/** `"shell"` → `"/shell"`，`"/shell/"` → `"/shell"`，`""` 与 `"/"` → `""`。 */
export function normalizeBasePath(value) {
    if (value === "" || value === "/") {
        return "";
    }
    const trimmed = value.replace(/\/+$/, "");
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
/** 按 `/` 切段并丢掉空段：`"/"` → `[]`，`"/log/"` → `["log"]`。 */
function segments(path) {
    return path.split("/").filter((part) => part !== "");
}
function matchPattern(pattern, path) {
    if (pattern.length !== path.length) {
        return null;
    }
    const params = {};
    for (const [index, part] of pattern.entries()) {
        const value = path[index] ?? "";
        // `:name` 只吃一段：日志文件名不含 `/`，多段路径应当落到 404 而不是被当成文件名。
        if (part.startsWith(":")) {
            try {
                params[part.slice(1)] = decodeURIComponent(value);
            }
            catch {
                // 畸形百分号编码（如 %E0%A4%A）不该冒成 500，按"这条路由不匹配"处理。
                return null;
            }
            continue;
        }
        if (part !== value) {
            return null;
        }
    }
    return params;
}
export function createRouter(options) {
    const basePath = normalizeBasePath(options.basePath ?? "");
    const routes = options.routes.map((route) => ({
        method: route.method,
        segments: segments(route.pattern),
        handler: route.handler,
    }));
    /** basePath 之外返回 null；`"/dbg"` 自身当归一化成 `"/"`。 */
    function strip(pathname) {
        if (basePath === "") {
            return pathname;
        }
        if (pathname === basePath) {
            return "/";
        }
        if (!pathname.startsWith(`${basePath}/`)) {
            return null;
        }
        return pathname.slice(basePath.length);
    }
    return {
        match(req) {
            const url = new URL(req.url);
            const path = strip(url.pathname);
            if (path === null) {
                return null;
            }
            // 尾随斜杠不算命中（`/health/` 仍 404），与改动前一致；`strip` 把 basePath
            // 自身归一成 `/`，所以挂载点带不带尾斜杠都进根路由。
            if (path.length > 1 && path.endsWith("/")) {
                return null;
            }
            for (const route of routes) {
                if (route.method !== req.method) {
                    continue;
                }
                const params = matchPattern(route.segments, segments(path));
                if (params !== null) {
                    return { url, params, handler: route.handler };
                }
            }
            return null;
        },
    };
}
