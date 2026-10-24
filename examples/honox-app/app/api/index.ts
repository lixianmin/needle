import type { Hono } from "hono";
import type { AppEnv } from "../env";
import { apcApi } from "./apc";
import { botsApi } from "./bots";
import { healthApi } from "./health";
import { homeApi } from "./home";
import { meApi } from "./me";
import { selectApcApi } from "./select-apc";

/**
 * 挂载所有 HTTP 接口：一个接口一个文件，这里只做登记。
 *
 * 中间件（reqId → 请求日志 → JWT 鉴权）由 createHonox 统一装好，这些路由挂在
 * 它后面，所以每条请求都会自动带上 uid，并打出 `-->` / `<--` 两行日志。
 */
export function registerApis(app: Hono<AppEnv>): void {
  app.route("/", homeApi);
  app.route("/", healthApi);
  app.route("/", meApi);
  app.route("/", botsApi);
  app.route("/", apcApi);
  app.route("/", selectApcApi);
}
