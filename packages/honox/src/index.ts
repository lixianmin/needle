import { logo, type Logger } from "@needle/logo";
import { createServerShell, type ServerShellOptions } from "@needle/shell";
import { Hono, type Context } from "hono";
import type { AuthOptions } from "./auth.js";
import { createSnowflake, type SnowflakeOptions } from "./id.js";
import { installMiddleware } from "./middleware.js";
import type { HonoxEnv, PublicEntry } from "./types.js";

/**
 * rid 的默认纪元：2014-12-09T00:00:00Z。
 *
 * 写 ISO 串而不是 `Date.UTC(2014, 12, 9)`：后者月份是 0-based，字面值其实是
 * 2015-01-09，差一个月——epoch 是写死的常量，写错了改回来就是 id 字典序断档。
 * 生产建议显式传自己的 epoch。
 */
const DEFAULT_EPOCH = Date.parse("2014-12-09T00:00:00Z");

export interface HonoxOptions {
  /** 请求日志用哪个 logger；默认 `@needle/logo` 的全局 `logo`。 */
  logger?: Logger;
  /** rid 的 Snowflake 配置。默认 epoch 2014-12-09T00:00:00Z、机器号 0；多实例必须给不同 nodeId。 */
  snowflake?: SnowflakeOptions;
  /** 解 token 的配置。白名单不在这里——用返回实例的 `allowAnonymous()`。 */
  auth: AuthOptions;
  /** 传了就把 Shell 控制台挂到 shell.basePath（默认 "/shell"）。 */
  shell?: ServerShellOptions;
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

  // 中间件链（rid → 请求日志 → JWT → 门禁）全在 middleware.ts，顺序由库固定。
  installMiddleware(app, {
    log,
    auth: options.auth,
    ids: createSnowflake(options.snowflake ?? { epoch: DEFAULT_EPOCH, nodeId: 0 }),
    public: publicEntries,
  });

  if (shell !== null && shellBasePath !== null) {
    const handle = (c: Context<HonoxEnv>) => shell.handler(c.req.raw);
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
export { createSnowflake, parseSnowflake } from "./id.js";
export type { Snowflake, SnowflakeOptions } from "./id.js";
export type { AuthOptions } from "./auth.js";
export type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";
