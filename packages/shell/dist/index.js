import { createAuthRoute } from "./authenticate.js";
import { createExecHandler } from "./exec.js";
import { ResponseX } from "./web/responsex.js";
import { renderPage } from "./page.js";
import { createRouter, normalizeBasePath } from "./router.js";
import { createShellSource } from "./source.js";
import { createSseResponse } from "./sse.js";
import { createLocalAdapter } from "./ui/local.js";
import { mountShell } from "./ui/view.js";
function bearer(header) {
    if (header === null) {
        return null;
    }
    const match = /^bearer\s+(.+)$/i.exec(header.trim());
    return match?.[1] ?? null;
}
/**
 * 服务端的 Shell：一个 `(Request) => Response`。
 *
 * 只做三件事：剥掉 basePath、按路径分派、把 token 换成用户身份。命令怎么执行、
 * 日志怎么推，全在 source 里——同一段逻辑浏览器里也在用。
 */
export function createServerShell(options) {
    const source = createShellSource(options);
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
        if (source.user !== null) {
            return source.user;
        }
        const verified = await source.auth.verify(bearer(req.headers.get("authorization")));
        return verified === null ? null : verified.sub;
    }
    async function logRoute({ req, params }) {
        const user = await resolveUser(req);
        if (user === null) {
            return ResponseX.unauthorized("未登录或 token 无效");
        }
        const body = await source.logFiles?.read(params.name ?? "");
        if (body === null || body === undefined) {
            return ResponseX.notFound("日志文件不存在");
        }
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
        if (user === null) {
            return ResponseX.unauthorized("未登录或 token 无效");
        }
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
            if (disposed) {
                return ResponseX.unavailable("shell disposed");
            }
            const found = router.match(req);
            // 消息里必须带方法与路径：只回 "not found" 等于没回，调用方无法判断是路径写错还是方法不对
            if (found === null) {
                return ResponseX.notFound(`未匹配的路由：${req.method} ${new URL(req.url).pathname}`);
            }
            // RouteHandler 可以同步返回 Response（页面、/health），也可以返回 Promise<Response>（要鉴权、
            // 要读日志的那些）。这里写成 async 就是归一化点：async 函数把普通返回值装进 Promise、把返回的
            // Promise 摊平，到出口一律是 Promise<Response>。Response 没丢，只是被装箱，调用方 await 即可；
            // 换来的是 serve/attach 只认一种形状。
            return found.handler({ req, url: found.url, params: found.params });
        },
        dispose() {
            disposed = true;
            source.dispose();
        },
    };
}
/**
 * 浏览器页面 / 扩展里的 Shell：把面板挂到一个 DOM 节点上。
 *
 * 与 createServerShell 用同一个 source，区别只是没有 HTTP：命令直调，
 * 日志通过 broadcast 直接流到面板。
 */
export function createBrowserShell(options) {
    const { element, ...rest } = options;
    const source = createShellSource(rest);
    const view = mountShell(element, createLocalAdapter(source));
    return {
        source,
        view,
        dispose() {
            view.dispose();
            source.dispose();
        },
    };
}
export { createShellSource } from "./source.js";
export { table } from "./table.js";
// 宿主应用可复用同一套错误契约（spec §8.2），不用自己再拼一份 {code, message}
export { ResponseX } from "./web/responsex.js";
export { mountShell } from "./ui/view.js";
export { createLocalAdapter } from "./ui/local.js";
export { createFetchAdapter } from "./ui/fetch-adapter.js";
