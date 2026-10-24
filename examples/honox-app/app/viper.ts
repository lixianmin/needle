import { loadConfig } from "@needle/honox/node";
// 下面的 `declare module "hono"` 要 TS 能从这个文件解析到 hono。示例里已经没有
// 别处直接 import hono 了（路由走 @needle/honox），TS 7 对只经传递依赖进 program
// 的模块名会报 TS2664。`import type {}` 运行期被抹掉，不会把 hono 拉进 bundle。
import type {} from "hono";

/**
 * 全进程唯一的配置实例（viper 风格取值器）。
 *
 * ENV 决定读 res/config/app_<env>.yml（只认 dev / fat / pro）；之后一律
 * `viper.getInt("server.web_port")`，不再碰 process.env。
 */
export const viper = loadConfig({
  dir: "res/config",
  required: ["auth.secret", "metadata.base_url", "server.web_port"],
});

/**
 * `c.get(...)` 的键在这里声明一次就够：接口文件不必再 import env 类型，
 * 直接写 `new Hono()`。新增 context 变量时补在这里。
 */
declare module "hono" {
  interface ContextVariableMap {
    uid: string | null;
  }
}
