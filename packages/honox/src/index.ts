import { logo, type Logger } from "@needle/logo";
import { createServerShell, type ServerShellOptions } from "@needle/shell";
import { Hono, type Context } from "hono";
import type { AuthOptions } from "./auth.js";
import { installMiddleware } from "./middleware.js";
import type { HonoxEnv, PublicEntry } from "./types.js";

export interface HonoxOptions<C extends object> {
  config: C;
  /** 默认 @needle/logo 的 logo 实例。 */
  log?: Logger;
  auth: AuthOptions;
  /** 传了就把 Shell 控制台挂到 shell.basePath（默认 "/shell"）。 */
  shell?: ServerShellOptions;
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
export function createHonox<C extends object>(
  options: HonoxOptions<C>,
): Hono<HonoxEnv<C>> {
  const log = options.log ?? logo;
  const app = new Hono<HonoxEnv<C>>();

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

  const publicEntries: PublicEntry[] = [
    ...(options.auth.public ?? []),
    ...(shellBasePath === null ? [] : [shellBasePath, `${shellBasePath}/*`]),
  ];

  // 中间件链（rid → 请求日志 → JWT → 门禁）全在 middleware.ts，顺序由库固定。
  installMiddleware(app, {
    config: options.config,
    log,
    auth: options.auth,
    public: publicEntries,
  });

  if (shell !== null && shellBasePath !== null) {
    const handle = (c: Context<HonoxEnv<C>>) => shell.handler(c.req.raw);
    app.all(shellBasePath, handle);
    app.all(`${shellBasePath}/*`, handle);
  }

  return app;
}

export type { Config } from "./config.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
