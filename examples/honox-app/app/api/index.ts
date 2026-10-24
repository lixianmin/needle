import type { HonoxApp } from "@needle/honox";
import { botsApi } from "./bots.js";
import { healthApi } from "./health.js";

/**
 * 挂载所有 HTTP 接口：一个领域一个文件，这里只做登记。
 *
 * 中间件（rid → 兜底日志 → JWT 鉴权）由 createHonox 统一装好，这些路由挂在
 * 它后面，所以每条请求都会自动带上 uid。请求日志不自动写：业务用 traceOf(ctx)
 * 自己决定打什么；库只补 401 / 404 / 500 / 慢请求。
 *
 * 免 JWT 门禁的路径用 allowAnonymous 写在下面——控制面跟接口清单一起，
 * 不用回头改 main.ts。没声明的路径一律要登录。
 */
export function registerApis(app: HonoxApp): void {
  app.route("/", healthApi);
  app.route("/", botsApi);

  app.allowAnonymous(["/health"]);
}
