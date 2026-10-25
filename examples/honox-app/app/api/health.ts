import { createApi } from "@needle/honox";

/**
 * 探活；在 JWT 白名单里，匿名可访问。
 *
 * 这里一行日志都不写——这正是「请求日志交给业务决定」要的效果：探活再怎么
 * 频繁也不会有日志噪音。
 */

export function createHealthApi() {
  const api = createApi("api/health");

  api.get("/health", ctx => ctx.json({ ok: true }));
  return api;
}