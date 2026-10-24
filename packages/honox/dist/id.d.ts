/**
 * Snowflake id：63 位整数 + 三段位。
 *
 * ```
 * 0 | 41 位毫秒 | 10 位机器号 | 12 位序列
 * ```
 *
 * - 最高位留 0：这样整个值落在 **signed 64 位**范围内，MySQL `BIGINT`、
 *   MongoDB `Long`（BSON int64）都能原样存，不会溢出。
 * - JS 的 `number` 只到 2^53，装不下 63 位：本模块一律用 `bigint`；
 *   序列化进 JSON 时必须转字符串（`JSON.stringify(1n)` 会直接抛 TypeError）。
 * - 时间位是 `now - epoch`，epoch 是**固定常量**（不是启动时间）：
 *   每次重启只是让时间继续往前走，不会把序列重置回起点。
 */
export interface SnowflakeOptions {
    /**
     * 纪元（epoch 毫秒）。必须是一个写死的常量，不能用启动时间——
     * 否则每次重启时间位都会从头开始，id 会重复。
     */
    epoch: number;
    /** 机器号 0..1023。单机随便给；多实例必须互不相同（可用 `nodeIdFromMac()`）。 */
    nodeId: number;
    /** 注入时钟，测试用。 */
    now?: () => number;
}
export interface Snowflake {
    /** 生成下一个 id。同一毫秒内序列递增；时钟回拨会抛错。 */
    next(): bigint;
}
/**
 * 创建一个 Snowflake 生成器。
 *
 * 时钟回拨：照原版算法**直接拒绝生成**。等时钟追上来会让请求卡住，
 * 静默产生更小的 id 又会破坏单调性（B 树回头插，正是要避免的页分裂）。
 * 序列溢出（同一毫秒超过 4096 个）则自旋等下一毫秒，这是 Snowflake 的常规做法。
 */
export declare function createSnowflake(options: SnowflakeOptions): Snowflake;
/** 把 id 拆回三段，测试与排障用。`elapsedMs` 是相对 epoch 的毫秒数。 */
export declare function parseSnowflake(id: bigint): {
    elapsedMs: number;
    nodeId: number;
    sequence: number;
};
//# sourceMappingURL=id.d.ts.map