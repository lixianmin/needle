import { readFileSync } from "node:fs";
import { createApi } from "@needle/honox";

/**
 * 测试台页面。启动时读一次、之后常驻内存，请求路径零 IO。
 *
 * 路径按 cwd 解析（与 `loadConfig({ dir: "res/config" })` 同一套约定）：`bun run dev`
 * 与镜像里的 `WORKDIR /app` 都是以示例目录为 cwd，`res/` 也随之进镜像。
 */
const HOME_HTML = readFileSync("res/web/home.html", "utf8");

/**
 * 根路径的测试台，在 JWT 白名单里——它本身就是拿 token 的入口，被门禁挡住就没法用。
 *
 * 一行日志都不写：静态页/探活这类高频请求正是「请求日志交给业务决定」要消掉的那类噪音。
 */

export function createHomeApi() {
  const api = createApi("api/home");

  api.get("/", ctx => ctx.html(HOME_HTML));
  return api;
}