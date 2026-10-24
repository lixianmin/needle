/** 环境变量源。测试注入用，生产就是 process.env。 */
export interface EnvLike {
    readonly [key: string]: string | undefined;
}
/**
 * 环境变量只有字符串；`true/false` 与纯数字要还原成布尔/数字，
 * 否则配置在不同来源下的类型不一致，业务代码得自己再转一遍。
 */
export declare function coerceValue(raw: string): unknown;
/**
 * 对象递归合并、数组整体替换——与 rim.proxy 的 `_deepMerge` 同语义。
 * 返回新对象，不改入参：调用方可能共用一份基础配置。
 */
export declare function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown>;
/**
 * 环境变量覆盖：`APP_AUTH__SECRET` → `auth.secret`。
 * 用双下划线分隔路径，因为单个下划线在变量名里太常见。
 */
export declare function applyEnv(base: Record<string, unknown>, env: EnvLike, prefix: string): Record<string, unknown>;
/** 必填项检查：缺失、或值是空字符串，都算没配。 */
export declare function assertRequired(config: Record<string, unknown>, required: readonly string[]): void;
