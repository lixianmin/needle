import type { HonoxEnv } from "@needle/honox";
import type { Config } from "@needle/honox/node";

/** createHonox 的 Env：配置以 viper 风格取值器的形态挂在 context 上。 */
export type AppEnv = HonoxEnv<Config>;
