import type { Logger } from "@needle/logo";
import { ResponseX } from "@needle/shell";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import type { MiddlewareHandler } from "hono";
import { JwtTokenExpired } from "hono/utils/jwt/types";
import type { AuthErrorReason, HonoxEnv, PublicEntry } from "./types.js";

export interface AuthOptions {
  /** HS256 密钥 */
  secret: string;
  /** uid 取自哪个 claim，默认 "sub" */
  claim?: string;
  /** 默认 "authorization"（Bearer token） */
  header?: string;
  /** 可选：header 里没 token 时从这个 cookie 兜底 */
  cookie?: string;
}

function matchesPattern(pattern: string, path: string): boolean {
  // 尾通配连基路径本身也算命中（`/assets/*` 命中 `/assets`）。
  // 不这么做的话，挂在子路径下的面板页（`/shell`）要额外再登记一条。
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }

  const patternSegments = pattern.split("/");
  const pathSegments = path.split("/");
  if (patternSegments.length !== pathSegments.length) {
    return false;
  }
  return patternSegments.every((segment, index) => {
    const actual = pathSegments[index] ?? "";
    if (segment.startsWith(":")) {
      return actual !== "";
    }
    return segment === actual;
  });
}

/** query 串不参与匹配：白名单记的是路由形状，不是某一次请求的完整 URL。 */
export function matchesPublic(
  entries: readonly PublicEntry[],
  method: string,
  path: string,
): boolean {
  const cleanPath = path.split("?")[0] ?? "";
  const upperMethod = method.toUpperCase();
  return entries.some((entry) => {
    if (typeof entry === "string") {
      return matchesPattern(entry, cleanPath);
    }
    return entry.method.toUpperCase() === upperMethod && matchesPattern(entry.path, cleanPath);
  });
}

function bearerOf(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  return /^bearer\s+(.+)$/i.exec(raw.trim())?.[1] ?? null;
}

function messageFor(reason: AuthErrorReason): string {
  switch (reason) {
    case "missing":
      return "需要登录";
    case "expired":
      return "登录已过期";
    case "invalid":
      return "token 无效";
  }
}

/**
 * 解 token + 门禁，一个中间件做完：解析失败不抛错，只把 uid 留空，
 * 让门禁统一决定 401。这样公开接口上带了个坏 token 也不会被拒。
 *
 * 白名单是第二个参数而不是 options 的字段：它是策略，不是「怎么解 token」的配置。
 * 传数组引用（不是拷贝），调用方后续往里 append 的条目对每个请求都生效。
 */
export function createAuth(
  options: AuthOptions,
  entries: readonly PublicEntry[],
  log: Logger,
): MiddlewareHandler<HonoxEnv> {
  const claim = options.claim ?? "sub";
  const headerName = options.header ?? "authorization";

  return async function auth(c, next) {
    const token =
      bearerOf(c.req.header(headerName)) ??
      (options.cookie === undefined ? null : (getCookie(c, options.cookie) ?? null));

    c.set("user", null);
    c.set("uid", null);
    c.set("authError", null);

    if (token !== null) {
      let reason: AuthErrorReason = "invalid";
      try {
        const payload = await verify(token, options.secret, "HS256");
        c.set("user", payload);
        const uid = payload[claim];
        if (typeof uid === "string" && uid !== "") {
          c.set("uid", uid);
          c.set("authError", null);
        } else {
          c.set("authError", reason);
        }
      } catch (error) {
        reason = error instanceof JwtTokenExpired ? "expired" : "invalid";
        c.set("authError", reason);
      }
    } else {
      c.set("authError", "missing");
    }

    if (matchesPublic(entries, c.req.method, c.req.path)) {
      return next();
    }

    const authError = c.get("authError") ?? "missing";
    if (c.get("uid") === null) {
      // 门禁是能拦下请求的最后一层，这里不记就没有任何地方会记。
      log.warn({
        rid: c.get("rid"),
        method: c.req.method,
        path: c.req.path,
        status: 401,
        authError,
      });
      return ResponseX.unauthorized(messageFor(authError));
    }
    return next();
  };
}
