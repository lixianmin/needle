import { logo, type Logger } from "@needle/logo";
import { ResponseX, createServerShell, type ServerShellOptions } from "@needle/shell";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthOptions } from "./auth.js";
import { installMiddleware } from "./middleware.js";
import { isRequestError } from "./request.js";
import type { HonoxEnv, PublicEntry } from "./types.js";

export interface HonoxOptions {
  /** 请求日志用哪个 logger；默认 `@needle/logo` 的全局 `logo`。 */
  logger?: Logger;
  /** 解 token 的配置。白名单不在这里——用返回实例的 `allowAnonymous()`。 */
  auth: AuthOptions;
  /** 传了就把 Shell 控制台挂到 shell.basePath（默认 "/shell"）。 */
  shell?: ServerShellOptions;
  /**
   * 慢请求阈值（毫秒），0 关闭。默认 1000：够长，正常接口不会被刷成 warn；
   * 够短，慢数据库往返跑不掉。请求日志其余部分由业务用 `traceOf(ctx)` 自己写。
   */
  slowMs?: number;
}

/**
 * `createHonox` 的返回值：Hono 实例 + 白名单声明入口。
 *
 * 用交叉类型而不是包装类，`app.route()` / `app.get()` 的 Hono 类型照旧可用。
 */
export type HonoxApp = Hono<HonoxEnv> & {
  /**
   * 声明这些路径不收 JWT 门禁（见 spec 8.3）。多次调用累加，返回实例本身可链式。
   *
   * 在挂载接口的地方调（示例是 `app/api/index.ts`），别塞回 `createHonox`：
   * 那是装配文件，把安全策略写进去等于加一个公开接口要动两个文件。
   */
  allowAnonymous(entries: readonly PublicEntry[]): HonoxApp;
};

/** HTTPException 的状态码 → 错误 code。表里没有的用 `http_error`，别现编。 */
const STATUS_CODES: Record<number, string> = {
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

function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? "http_error";
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed;
}

/**
 * 装配一个 Hono app：建实例 → 装中间件链（见 middleware.ts）→ 挂 Shell 面板。
 *
 * 业务路由挂在返回值上，所以自动继承中间件链。
 */
export function createHonox(options: HonoxOptions): HonoxApp {
  const log = options.logger ?? logo;
  const app = new Hono<HonoxEnv>();

  const shellBasePath =
    options.shell === undefined ? null : normalizeBasePath(options.shell.basePath ?? "/shell");
  if (shellBasePath === "") {
    // 挂到根路径等于把整站写进白名单——这种配置错误必须在启动时炸，不能默默放行。
    throw new Error("shell.basePath 不能是根路径：请挂到 /shell 这类子路径");
  }
  const shell =
    options.shell === undefined || shellBasePath === null
      ? null
      : createServerShell({ ...options.shell, basePath: shellBasePath });

  const publicEntries: PublicEntry[] =
    shellBasePath === null ? [] : [shellBasePath, `${shellBasePath}/*`];

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

  if (shell !== null && shellBasePath !== null) {
    const handle = async (c: Context<HonoxEnv>) => {
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
  const honox = app as HonoxApp;
  honox.allowAnonymous = (entries) => {
    publicEntries.push(...entries);
    return honox;
  };

  return honox;
}

export type { Config } from "./config.js";
export { apiRoute, createApi } from "./route.js";
export type { ApiHandler } from "./route.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
export { RequestError, isRequestError } from "./request.js";
export { traceOf } from "./trace.js";
export type { Trace } from "./trace.js";
export { modelSchema, registerModel } from "./model.js";
export type { ModelClass } from "./model.js";
export type { ParsedHandler } from "./route.js";
