import type { HonoxEnv } from "@needle/honox";

/** `res/config/*.yml` 合出来的配置形状。 */
export type AppConfig = {
  auth: { secret: string };
  metadata: { base_url: string };
  server?: { web_port?: number; host?: string };
};

/** createHonox 的 Env：`c.get("uid")` / `c.get("reqId")` 的类型从这里来。 */
export type AppEnv = HonoxEnv<AppConfig>;
