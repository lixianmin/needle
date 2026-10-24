import type { HonoxEnv } from "@needle/honox";
import { loadConfig } from "@needle/honox/node";

/**
 * 全进程唯一的配置实例。
 *
 * 请求内用它：`c.get("config").getInt("server.web_port")`（AppEnv 里有类型）。
 * 请求外用 import：`import { config } from "../env"`。
 * 模块只求值一次，所以这里读文件也只发生一次。
 */
export const config = loadConfig({
  dir: "res/config",
  required: ["auth.secret", "metadata.base_url", "server.web_port"],
});

/** createHonox 的 Env：配置以 viper 风格取值器的形态挂在 context 上。 */
export type AppEnv = HonoxEnv<typeof config>;
