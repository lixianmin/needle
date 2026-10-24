import { loadConfig } from "@needle/honox/node";

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
