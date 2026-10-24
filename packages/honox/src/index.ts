import { logo, type Logger } from "@needle/logo";
import { createServerShell, type ServerShellOptions } from "@needle/shell";
import { Hono, type Context } from "hono";
import { createAuth, type AuthOptions } from "./auth.js";
import { createRequestLog } from "./request-log.js";
import type { HonoxEnv, PublicEntry } from "./types.js";
import { ulid } from "./ulid.js";

export interface HonoxOptions<C extends object> {
  config: C;
  /** 默认 @needle/logo 的 logo 实例。 */
  log?: Logger;
  auth: AuthOptions;
  /** 传了就把 Shell 控制台挂到 shell.basePath（默认 "/shell"）。 */
  shell?: ServerShellOptions;
}

/** 入站请求可以自带 rid：`x-rid` 优先，其次是网关常见的 `x-request-id`。 */
const RID_HEADERS = ["x-rid", "x-request-id"] as const;

/**
 * 接受外部 rid 的形状：只放行不会破坏日志行的字符。
 * 不加这道限制，请求头里塞换行就能伪造日志行（log injection）。
 */
const RID_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;

function resolveRid(header: (name: string) => string | undefined): string {
  for (const name of RID_HEADERS) {
    const value = header(name);
    if (value !== undefined && RID_PATTERN.test(value)) {
      return value;
    }
  }
  return ulid();
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed;
}

/**
 * 装配一个 Hono app：rid → 请求日志 → JWT → 门禁，顺序由库固定。
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
    // 调用方带了就用它的（网关/上游的链路 id 才能串起来），没带才自己生成。
    const rid = resolveRid((name) => c.req.header(name));
    c.set("rid", rid);
    c.set("config", options.config);
    c.set("log", log);
    await next();
    c.header("x-rid", rid);
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
