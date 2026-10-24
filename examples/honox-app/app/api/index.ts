import type { Env, Hono } from "hono";
import { botsApi } from "./bots.js";
import { healthApi } from "./health.js";

/**
 * 挂载所有 HTTP 接口：一个领域一个文件，这里只做登记。
 *
 * 中间件（rid → 请求日志 → JWT 鉴权）由 createHonox 统一装好，这些路由挂在
 * 它后面，所以每条请求都会自动带上 uid，并落两行日志。
 */
export function registerApis<E extends Env>(app: Hono<E>): void {
  app.route("/", healthApi);
  app.route("/", botsApi);
}
