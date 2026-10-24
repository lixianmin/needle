/**
 * id 生成：两种，用途不同。
 *
 * - `nextUlid()`：**请求 id（rid）用它**。48 位毫秒 + 80 位密码学随机，
 *   不需要任何机器号配置，多实例 / 多进程 / 容器重建都不会撞。
 * - `nextSnowflakeId()`：**业务实体 id 用它**。13 位紧凑、严格单调，
 *   代价是要保证机器号唯一（多实例必须显式传）。
 *
 * 为什么 rid 不用 Snowflake：Snowflake 的机器号只有 10 位（1024 个桶），
 * MAC / IP 再怎么取也是哈希进这 1024 个桶，38 个实例就有 50% 概率撞号；
 * 而序列位每毫秒从 0 开始，撞了号的两个实例在同一毫秒各发一个号就是**直接重号**。
 * rid 只用于串日志，不需要定长紧凑，也不需要严格单调——用 80 位随机换掉
 * "必须配对机器号"这类配置错误，更划算。
 */
/**
 * Snowflake 的默认纪元：2014-12-09T00:00:00Z。
 *
 * 写 ISO 串而不是 `Date.UTC(2014, 12, 9)`：后者月份是 0-based，字面值其实是
 * 2015-01-09，差一个月——epoch 是写死的常量，写错了改回来就是 id 字典序断档。
 */
export declare const DEFAULT_EPOCH: number;
export interface SnowflakeOptions {
    /**
     * 纪元（epoch 毫秒）。必须是一个写死的常量，不能用启动时间——
     * 否则每次重启时间位都会从头开始，id 会重复。
     */
    epoch: number;
    /** 机器号 0..1023。单机随便给；多实例必须互不相同，从部署配置里给（不要从 MAC / IP 派生：10 位桶会撞）。 */
    nodeId: number;
    /** 注入时钟，测试用。 */
    now?: () => number;
}
export interface Snowflake {
    /** 生成下一个 id：定长 13 位 Crockford Base32。同一毫秒内序列递增；时钟回拨会抛错。 */
    next(): string;
}
/** `nextSnowflakeId()` 的可选参数：不传就是默认纪元 + 机器号 0。 */
export interface NextSnowflakeOptions {
    /** 纪元（epoch 毫秒），默认 `DEFAULT_EPOCH`。 */
    epoch?: number;
    /** 机器号 0..1023，默认 0。**多实例必须传不同的号**，否则同一毫秒会重号。 */
    nodeId?: number;
}
/**
 * 创建一个 Snowflake 生成器。
 *
 * 时钟回拨：照原版算法**直接拒绝生成**。等时钟追上来会让请求卡住，
 * 静默产生更小的 id 又会破坏单调性（B 树回头插，正是要避免的页分裂）。
 * 序列溢出（同一毫秒超过 4096 个）则自旋等下一毫秒，这是 Snowflake 的常规做法。
 */
export declare function createSnowflake(options: SnowflakeOptions): Snowflake;
/**
 * 生成一个业务实体 id：定长 13 位，字典序 = 生成顺序。
 *
 * 不传参数 = 默认纪元 + 机器号 0，**只适用于单实例或单进程**。
 * 多实例部署必须传互不相同的 `nodeId`（否则同一毫秒会重号）；
 * 拿不到稳定机器号时，改用 `nextUlid()`。
 */
export declare function nextSnowflakeId(options?: NextSnowflakeOptions): string;
/** 把 id 拆回三段，测试与排障用。`elapsedMs` 是相对 epoch 的毫秒数。 */
export declare function parseSnowflake(id: string): {
    elapsedMs: number;
    nodeId: number;
    sequence: number;
};
/**
 * 生成一个 ULID：请求 id（rid）用它。
 *
 * `now` 只给测试注入用，业务代码不传。
 */
export declare function nextUlid(now?: number): string;
//# sourceMappingURL=id-tools.d.ts.map