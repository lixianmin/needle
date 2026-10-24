/**
 * Snowflake id：63 位整数 + 三段位，对外一律是**定长 13 位 Crockford Base32 字符串**。
 *
 * ```
 * 0 | 41 位毫秒 | 10 位机器号 | 12 位序列
 * ```
 *
 * 为什么对外只给字符串，不给 bigint：
 * - 63 位装不进 JS 的 `number`（只到 2^53），而 `JSON.stringify(bigint)` 直接抛
 *   TypeError。只要把 bigint 漏出去，就得靠每个调用点记得 `String()`——忘一次就是
 *   `c.json` 500 或者悄悄截断，这种"靠记性"的约束不该存在。
 * - 字符串从生成那一刻起就是最终形态：写日志、进 JSON、存 Mongo / MySQL 都不用转。
 *
 * 为什么定长 13 位：
 * - 63 位 ÷ 5 bit/字符 = 12.6 → 13 个字符正好装下（多出的 2 位恒为 0）。
 * - **等长才能让"字典序 = 数值序"**。若直接用十进制字符串，位数会从 10 涨到 19，
 *   而 `"9..."` 排在 `"10..."` 前面——新 id 会插到旧 id 之前，正是要避免的
 *   B 树回头插 / 页分裂。零填充也能解决，但 13 位比 19 位省 6 字节。
 * - Crockford 字母表去掉 I / L / O / U（容易看混），输出用小写（日志、URL、DB 里都好读）。
 *   ASCII 里 0-9 (48-57) 在 a-z (97-122) 之前，字母本身也升序，所以定长小写串
 *   仍然"字典序 = 数值序"。**必须全小写**：混用大小写会破坏这个性质。
 *
 * 时间位是 `now - epoch`，epoch 是**固定常量**（不是启动时间）：每次重启只是让
 * 时间继续往前走，不会把序列重置回起点。
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
    /** 生成下一个 id：定长 13 位 Crockford Base32。同一毫秒内序列递增；时钟回拨会抛错。 */
    next(): string;
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
export declare function parseSnowflake(id: string): {
    elapsedMs: number;
    nodeId: number;
    sequence: number;
};
//# sourceMappingURL=id.d.ts.map