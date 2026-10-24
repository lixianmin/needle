import { type Config, type EnvLike } from "./config.js";
export type { Config } from "./config.js";
/** 只认这三种环境；写错的 ENV 会在启动时直接报错，而不是变成"找不到文件"。 */
export declare const SUPPORTED_ENVS: readonly ["dev", "fat", "pro"];
export interface LoadConfigOptions {
    /** 配置目录，默认 "config"（相对 process.cwd()）。 */
    dir?: string;
    /** 环境名，默认 process.env.ENV ?? "dev"；必须是 dev / fat / pro。 */
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
 * 环境名取 `ENV`（照 rim.server：默认 DEV），只接受 dev / fat / pro。
 * 这是**唯一**读 `process.env.ENV` 的地方；业务侧一律用 `config.isPro()` 这类方法判断，
 * 不要再自己去看环境变量。
 *
 * 返回值是 viper 风格的取值器（`config.getInt("server.web_port")`），不是裸对象：
 * 点分路径的兼容、缺值报错、`APP_SERVER__WEB_PORT` 这类覆盖都收在这一层。
 */
export declare function loadConfig<C extends Record<string, unknown>>(options?: LoadConfigOptions): Config<C>;
/**
 * 从网卡 MAC 派生 10 位机器号（0..1023）。
 *
 * 取所有非内部的 MAC，排序后 FNV-1a 哈希：同一台机器每次算出同一个号，
 * 不用配置。注意容器（Docker 默认）每次重建 MAC 都会变——多实例部署请显式
 * 配 nodeId，别依赖这里。
 */
export declare function nodeIdFromMac(): number;
//# sourceMappingURL=node.d.ts.map