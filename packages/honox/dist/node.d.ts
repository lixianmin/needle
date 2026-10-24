import { type EnvLike } from "./config.js";
export interface LoadConfigOptions {
    /** 配置目录，默认 "config"（相对 process.cwd()）。 */
    dir?: string;
    /** 环境名，默认 process.env.ENV ?? "dev"；转小写后拼文件名。 */
    env?: string;
    /** 环境变量源，默认 process.env。 */
    envVars?: EnvLike;
    /** 环境变量前缀，默认 "APP_"。 */
    envPrefix?: string;
    /** 必填的点分路径，如 ["auth.secret"]。 */
    required?: readonly string[];
}
/**
 * 加载顺序：`<dir>/common.yml` → `<dir>/app_<env>.yml` → `APP_*` 环境变量 → 必填检查。
 *
 * env 不做白名单：工具库硬编码业务环境名（DEV/FAT/UAT…）会把别处的约定带进来，
 * 写错环境名的表现就是文件不存在，报错里带 ENV 值足够定位。
 */
export declare function loadConfig<C extends Record<string, unknown>>(options?: LoadConfigOptions): C;
