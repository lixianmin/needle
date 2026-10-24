import { logo, type Logger } from "@needle/logo";
import { createServerShell, type ServerShellOptions } from "@needle/shell";
import { Hono, type Context } from "hono";
import { createAuth, type AuthOptions } from "./auth.js";
import { createRequestLog } from "./request-log.js";
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
 * 装配一个 Hono app：reqId → 请求日志 → JWT → 门禁，顺序由库固定。
 *
 * 顺序不能交给业务：日志排在门禁前面，401 才有结束行；JWT 排在门禁前面，
 * 门禁才看得到 uid。这两个顺序错一个，症状都很隐蔽（"日志偶尔少一行"）。
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
    const handle = (c: Context<HonoxEnv<C>>) => shell.handler(c.req.raw);
    app.all(shellBasePath, handle);
    app.all(`${shellBasePath}/*`, handle);
  }

  return app;
}

export type { Config } from "./config.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
