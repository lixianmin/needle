import { createAuthRoute } from "./authenticate.js";
import { createExecHandler } from "./exec.js";
import { renderPage } from "./page.js";
import { createRouter, normalizeBasePath } from "./router.js";
import { createConsoleSource } from "./source.js";
import { createSseResponse } from "./sse.js";
import { createLocalAdapter } from "./ui/local.js";
import { mountConsole } from "./ui/view.js";
function bearer(header) {
    if (header === null)
        return null;
    const match = /^bearer\s+(.+)$/i.exec(header.trim());
    return match?.[1] ?? null;
}
/**
 * 服务端的控制台：一个 `(Request) => Response`。
 *
 * 只做三件事：剥掉 basePath、按路径分派、把 token 换成用户身份。命令怎么执行、
 * 日志怎么推，全在 source 里——同一段逻辑浏览器里也在用。
 */
export function createConsole(options) {
    const source = createConsoleSource(options);
    const basePath = normalizeBasePath(options.basePath ?? "");
    const exec = createExecHandler({ source });
    const authenticate = createAuthRoute({ source });
    const page = renderPage({
        basePath,
        title: source.title,
        version: source.version,
        ...(options.topicSpec === undefined ? {} : { topicSpec: options.topicSpec }),
    });
    let disposed = false;
    function pageRoute() {
        return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    /**
     * 本地模式（配了 user）直接用配置的身份；服务端模式校验 Bearer token，
     * 没有有效 token 返回 null。`/log/:name` 与 `/events` 共用这一处口径。
     */
    async function resolveUser(req) {
        if (source.user !== null)
            return source.user;
        const verified = await source.auth.verify(bearer(req.headers.get("authorization")));
        return verified === null ? null : verified.sub;
    }
    async function logRoute({ req, params }) {
        if ((await resolveUser(req)) === null)
            return new Response("unauthorized", { status: 401 });
        const body = await source.logFiles?.read(params.name ?? "");
        if (body === null || body === undefined)
            return new Response("not found", { status: 404 });
        return new Response(body, {
            headers: {
                "content-type": "text/plain; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }
    async function eventsRoute({ req, url }) {
        // 事件流必须鉴权：日志里什么都有，匿名不该看到。本地模式是唯一的例外，理由同 /log/。
        const user = await resolveUser(req);
        if (user === null)
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        return createSseResponse({
            user,
            title: source.title,
            version: source.version,
            commands: source.commands,
            topics: source.topics,
            topicSpec: url.searchParams.get("topics"),
            broadcast: source.broadcast,
        });
    }
    const routes = [
        { method: "GET", pattern: "/", handler: pageRoute },
        { method: "GET", pattern: "/index.html", handler: pageRoute },
        { method: "GET", pattern: "/health", handler: () => Response.json({ ok: true }) },
        { method: "GET", pattern: "/events", handler: eventsRoute },
        { method: "GET", pattern: "/log/:name", handler: logRoute },
        { method: "POST", pattern: "/exec", handler: ({ req }) => exec(req) },
        { method: "POST", pattern: "/auth", handler: ({ req }) => authenticate(req) },
    ];
    const router = createRouter({
        basePath,
        routes,
    });
    return {
        source,
        async handler(req) {
            if (disposed)
                return Response.json({ ok: false, error: "console disposed" }, { status: 503 });
            const found = router.match(req);
            if (found === null)
                return new Response("not found", { status: 404 });
            return found.handler({ req, url: found.url, params: found.params });
        },
        dispose() {
            disposed = true;
            source.dispose();
        },
    };
}
/**
 * 浏览器页面 / 扩展里的控制台：把面板挂到一个 DOM 节点上。
 *
 * 与 createConsole 用同一个 source，区别只是没有 HTTP：命令直调，
 * 日志通过 broadcast 直接流到面板。
 */
export function createBrowserConsole(options) {
    const { element, ...rest } = options;
    const source = createConsoleSource(rest);
    const view = mountConsole(element, createLocalAdapter(source));
    return {
        source,
        view,
        dispose() {
            view.dispose();
            source.dispose();
        },
    };
}
export { createConsoleSource } from "./source.js";
export { mountConsole } from "./ui/view.js";
export { createLocalAdapter } from "./ui/local.js";
