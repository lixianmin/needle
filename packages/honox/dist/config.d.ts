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
/** 按点分路径取值；中间层不是对象就当不存在（与 viper 的 Get 语义一致）。 */
export declare function readPath(data: Record<string, unknown>, path: string): unknown;
export interface Config<C extends Record<string, unknown> = Record<string, unknown>> {
    /** 环境名：`dev` / `fat` / `pro`（已小写归一）。 */
    readonly env: string;
    isDev(): boolean;
    isFat(): boolean;
    isPro(): boolean;
    /** 路径上有值就算 true（null 也算有）。 */
    has(path: string): boolean;
    get(path: string): unknown;
    /** 缺省值给了就不抛；没给且缺失 → 抛。 */
    getString(path: string, fallback?: string): string;
    getInt(path: string, fallback?: number): number;
    getBool(path: string, fallback?: boolean): boolean;
    /** 取一层 key→string 的映射（YAML 的数字会被转成字符串）。缺省给 {}。 */
    getStringMap(path: string): Record<string, string>;
    /** 合并后的原始数据，只读用途（整段透传给别的库之类）。 */
    raw(): C;
}
/**
 * 把合并结果包成 viper 风格的取值器：调用方只认 `config.getInt("server.web_port")`，
 * 不再各自去摸 `process.env`，也不用手写一遍点分路径的兼容代码。
 *
 * 取值语义比 viper 严一点：缺值又没给 fallback 就抛。viper 返回零值（"" / 0），
 * 配置写错时表现成「端口 0」「密钥空」，排查成本比报错高得多。
 */
export declare function createConfig<C extends Record<string, unknown>>(data: C, env: string): Config<C>;
