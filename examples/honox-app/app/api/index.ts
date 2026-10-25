import type { HonoxApp } from "@needle/honox";
import { createBotsApi } from "./bots.js";
import { createHealthApi } from "./health.js";
import { createHomeApi } from "./home.js";
import { createLoginApi } from "./login.js";

/**
 * 业务接口的版本前缀。
 *
 * 版本号只在这里出现一次：组内路径一律从挂载点之后算起，升 v2 就是再建一个 v2 组，
 * 不用去每个接口文件里改字符串（那种写法迟早会漂移成一个文件 /v1、另一个文件 /v2）。
 *
 * 只给业务接口版本化，health / shell / 首页都不带：探针和运维面是部署配置里写死的
 * 一次性契约（Kubernetes 自己的 /healthz、/livez、/readyz 也在根上），跟着业务
 * 大版本走等于每升一版都要改一轮探针配置；首页是页面，不是机读契约。
 */
const API_PREFIX = "/api/v1";

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
  app.route("/", createHomeApi());
  app.route("/", createHealthApi());
  app.route(`${API_PREFIX}/login`, createLoginApi());
  app.route(`${API_PREFIX}/bots`, createBotsApi());

  // 业务面：版本前缀只出现在这个文件里，接口组直接挂到根上。
  //
  // 不要用 `new Hono().basePath(API_PREFIX)` 套一层「版本组」：Hono 的 route() 在
  // 子应用带自己的 errorHandler 时会把每个 handler 包进子应用的处理链，父层
  // `app.onError` 就再也收不到这个组的异常——表现为参数校验失败返回 500
  // "Internal Server Error" 而不是 400（实测：直挂 400，套一层 500）。
  // 也不能用 `const v1 = app.route(...)`：route() 返回父 app，从它登记会把
  // /login 挂到根上，且只拷贝挂载那一刻的路由。

  // 测试台（`/`）与 mock 登录（`/api/v1/login`）必须匿名可达：页面本身就是拿 token
  // 的入口，被门禁挡住就永远拿不到第一枚 token。
  app.allowAnonymous(["/", "/health", `${API_PREFIX}/login`]);
}
