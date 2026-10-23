import { createAuthRoute } from "./authenticate.js";
import { createExecHandler } from "./exec.js";
import { ResponseX } from "../core/web/responsex.js";
import { renderPage } from "./page.js";
import { createRouter, normalizeBasePath, type Route, type RouteContext } from "./router.js";
import { createConsoleSource, type ConsoleSource, type ConsoleSourceOptions } from "./source.js";
import { createSseResponse } from "./sse.js";
import { createLocalAdapter } from "./ui/local.js";
import { mountConsole, type ConsoleView } from "./ui/view.js";

export interface ConsoleOptions extends ConsoleSourceOptions {
  /** 挂载前缀，如 "/console"。默认挂在根路径。 */
  basePath?: string;
  /** 页面默认订阅的主题，如 "top:5000"。 */
  topicSpec?: string;
}

export interface Console {
  handler(req: Request): Promise<Response>;
  source: ConsoleSource;
  dispose(): void;
}


function bearer(header: string | null): string | null {
  if (header === null) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * 服务端的控制台：一个 `(Request) => Response`。
 *
 * 只做三件事：剥掉 basePath、按路径分派、把 token 换成用户身份。命令怎么执行、
 * 日志怎么推，全在 source 里——同一段逻辑浏览器里也在用。
 */
export function createConsole(options: ConsoleOptions): Console {
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

  function pageRoute(): Response {
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  /**
   * 本地模式（配了 user）直接用配置的身份；服务端模式校验 Bearer token，
   * 没有有效 token 返回 null。`/log/:name` 与 `/events` 共用这一处口径。
   */
  async function resolveUser(req: Request): Promise<string | null> {
    if (source.user !== null) return source.user;
    const verified = await source.auth.verify(bearer(req.headers.get("authorization")));
    return verified === null ? null : verified.sub;
  }

  async function logRoute({ req, params }: RouteContext): Promise<Response> {
    if ((await resolveUser(req)) === null) return ResponseX.unauthorized("未登录或 token 无效");

    const body = await source.logFiles?.read(params.name ?? "");
    if (body === null || body === undefined) return ResponseX.notFound("日志文件不存在");

    return new Response(body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  async function eventsRoute({ req, url }: RouteContext): Promise<Response> {
    // 事件流必须鉴权：日志里什么都有，匿名不该看到。本地模式是唯一的例外，理由同 /log/。
    const user = await resolveUser(req);
    if (user === null) return ResponseX.unauthorized("未登录或 token 无效");

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

  const routes: Route[] = [
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
      if (disposed) return ResponseX.unavailable("console disposed");

      const found = router.match(req);
      if (found === null) return ResponseX.notFound("not found");

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
export function createBrowserConsole(
  options: ConsoleSourceOptions & { element: HTMLElement },
): { source: ConsoleSource; view: ConsoleView; dispose(): void } {
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
export type { ConsoleSource, ConsoleSourceOptions, ExecResult } from "./source.js";
export type { ConsoleAdapter, ConsoleEvent, HandshakeInfo, AuthResult } from "./ui/adapter.js";
export type { AuthOptions, Command, CommandContext, CommandOutput, Topic } from "./types.js";
