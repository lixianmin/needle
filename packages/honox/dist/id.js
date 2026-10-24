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
const NODE_BITS = 10n;
const SEQUENCE_BITS = 12n;
const NODE_MAX = (1n << NODE_BITS) - 1n;
const SEQUENCE_MAX = (1n << SEQUENCE_BITS) - 1n;
/** 41 位毫秒能表示约 69 年；超了说明 epoch 配错了，直接报错而不是静默截断。 */
const TIME_MAX = (1n << 41n) - 1n;
/**
 * 创建一个 Snowflake 生成器。
 *
 * 时钟回拨：照原版算法**直接拒绝生成**。等时钟追上来会让请求卡住，
 * 静默产生更小的 id 又会破坏单调性（B 树回头插，正是要避免的页分裂）。
 * 序列溢出（同一毫秒超过 4096 个）则自旋等下一毫秒，这是 Snowflake 的常规做法。
 */
export function createSnowflake(options) {
    if (!Number.isInteger(options.nodeId) || options.nodeId < 0 || BigInt(options.nodeId) > NODE_MAX) {
        throw new Error(`nodeId 必须是 0..${NODE_MAX} 的整数：${options.nodeId}`);
    }
    const epoch = options.epoch;
    const node = BigInt(options.nodeId);
    const now = options.now ?? Date.now;
    let lastMs = -1;
    let sequence = 0n;
    function untilNextMillis(previous) {
        let current = now();
        while (current <= previous) {
            current = now();
        }
        return current;
    }
    return {
        next() {
            let current = now();
            if (current < lastMs) {
                throw new Error(`时钟回拨 ${lastMs - current}ms：拒绝生成 id（否则会破坏单调性）。检查 NTP / 容器时钟`);
            }
            if (current === lastMs) {
                sequence += 1n;
                if (sequence > SEQUENCE_MAX) {
                    // 这一毫秒的 4096 个号用完了：等下一毫秒，号不会丢也不会重。
                    current = untilNextMillis(lastMs);
                    sequence = 0n;
                }
            }
            else {
                sequence = 0n;
            }
            const elapsed = current - epoch;
            if (elapsed < 0) {
                throw new Error(`当前时间早于 epoch（${epoch}）：检查系统时钟或 epoch 配置`);
            }
            if (BigInt(elapsed) > TIME_MAX) {
                throw new Error(`epoch 太早：41 位毫秒只够 ${Math.floor(Number(TIME_MAX) / 31_536_000_000)} 年`);
            }
            lastMs = current;
            return (BigInt(elapsed) << (NODE_BITS + SEQUENCE_BITS)) | (node << SEQUENCE_BITS) | sequence;
        },
    };
}
/** 把 id 拆回三段，测试与排障用。`elapsedMs` 是相对 epoch 的毫秒数。 */
export function parseSnowflake(id) {
    return {
        elapsedMs: Number(id >> (NODE_BITS + SEQUENCE_BITS)),
        nodeId: Number((id >> SEQUENCE_BITS) & NODE_MAX),
        sequence: Number(id & SEQUENCE_MAX),
    };
}
