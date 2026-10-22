import { createExecHandler } from "./exec.js";
import { renderPage } from "./page.js";
import { createConsoleSource, type ConsoleSource, type ConsoleSourceOptions } from "./source.js";
import { createSseResponse } from "./sse.js";
import type { AuthOptions, Command, CommandContext, CommandOutput, Topic } from "./types.js";
import { createLocalAdapter } from "./ui/local.js";
import { mountConsole, type ConsoleView } from "./ui/view.js";
import type { ConsoleAdapter, ConsoleEvent, HelloInfo } from "./ui/adapter.js";

export interface ConsoleOptions extends ConsoleSourceOptions {
  /** 挂载前缀，如 "/__dbg"。默认挂在根路径。 */
  basePath?: string;
  /** 页面默认订阅的主题，如 "top:5000"。 */
  topicSpec?: string;
}

export interface Console {
  handler(req: Request): Promise<Response>;
  source: ConsoleSource;
  dispose(): void;
}

function normalizeBasePath(value: string): string {
  if (value === "" || value === "/") return "";
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

  const page = renderPage({
    basePath,
    version: source.version,
    ...(options.topicSpec === undefined ? {} : { topicSpec: options.topicSpec }),
  });

  let disposed = false;

  function strip(pathname: string): string | null {
    if (basePath === "") return pathname;
    if (pathname === basePath) return "/";
    if (!pathname.startsWith(`${basePath}/`)) return null;
    return pathname.slice(basePath.length);
  }

  return {
    source,

    async handler(req) {
      if (disposed) return json({ ok: false, error: "console disposed" }, 503);

      const url = new URL(req.url);
      const path = strip(url.pathname);
      if (path === null) return new Response("not found", { status: 404 });

      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (req.method === "GET" && path === "/health") return json({ ok: true });

      if (req.method === "POST" && path === "/exec") return exec(req);

      if (req.method === "GET" && path === "/events") {
        // 事件流必须鉴权：日志里什么都有，匿名不该看到。
        const verified = await source.auth.verify(bearer(req.headers.get("authorization")));
        if (verified === null) return json({ ok: false, error: "unauthorized" }, 401);

        return createSseResponse({
          user: verified.sub,
          version: source.version,
          commands: source.commands,
          topics: source.topics,
          topicSpec: url.searchParams.get("topics"),
          broadcast: source.broadcast,
        });
      }

      return new Response("not found", { status: 404 });
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
export type { ConsoleAdapter, ConsoleEvent, HelloInfo } from "./ui/adapter.js";
export type { AuthOptions, Command, CommandContext, CommandOutput, Topic } from "./types.js";
