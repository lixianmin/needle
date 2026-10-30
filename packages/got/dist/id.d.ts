/**
 * id 生成：UUIDv7 位布局 + Crockford Base32 文本，**同一毫秒内严格单调**。
 *
 * ```
 * 128 位 = 48 位毫秒 | 4 位 version(=7) | 12 位 rand_a | 2 位 variant(=10) | 62 位 rand_b
 *                     └──── 时间（可排序）────┴────── 随机段 74 位（单调计数器）──────┘
 * ```
 *
 * 三条取舍：
 *
 * - **时间在最前面**：主键的字典序 = 生成顺序，B-tree 只往右追加，不回头插页；
 *   范围扫描（按时间查 id 区间）也直接落在有序段上。UUIDv4 / CUID2 那种纯随机
 *   布局做不到这一点，在 InnoDB 这类聚簇索引上会是随机的页分裂。
 * - **不要机器号**：Snowflake 的 10 位机器号要靠部署配置保证唯一（MAC / IP 哈希进
 *   1024 个桶，38 个实例就有一半概率撞），撞了就是同毫秒重号。这里的随机段每毫秒
 *   重抽一次，多实例、多进程、容器重建都不需要协调。
 * - **同一毫秒不靠新随机数，而是随机段 +1**：纯随机的 ULID 在同一毫秒内约一半的
 *   id 比前一个小（实测 20 万次里 99818 次倒退），不能当可排序主键。这里按
 *   RFC 9562 §6.2 Method 2，同毫秒把 74 位随机段当计数器 +1（带进位），溢出就把
 *   时间前进 1ms 再抽新随机段。
 *
 * 保留 version / variant 两个字段（共 6 位不参与熵）：换来的 16 字节能直接写进
 * UUID 列、和外部系统对接（`nextIdUuid()` / `idToUuid()`），代价是随机段 74 位而不是
 * ULID 的 80 位——跨机器同毫秒撞号要两个实例抽出同一个 74 位随机数，概率 2⁻⁷⁴ 量级，
 * 任何真实流量下都可以忽略。
 *
 * 文本形态是 26 位大写 Crockford Base32（去掉 I / L / O / U）：5 位/字符，128 位正好
 * 26 个字符，可以随便进日志、URL、口头念给别人；大写是 Crockford 的规范形式，解码时
 * 一律先转大写，所以大小写不敏感。
 */
export interface IdGeneratorOptions {
    /** 时钟，测试注入用；默认 `Date.now`。 */
    now?: () => number;
    /** 随机源，测试注入用；默认 `crypto.getRandomValues`。 */
    random?: (target: Uint8Array) => void;
}
export interface IdGenerator {
    /** 26 位大写 Crockford Base32。 */
    next(): string;
    /** 同一串 id 的 16 字节形态（BINARY(16) 主键用）。每次返回独立副本。 */
    nextBytes(): Uint8Array;
    /** 同一串 id 的 UUIDv7 规范文本，给只能收 UUID 的外部系统。 */
    nextUuid(): string;
}
/**
 * 创建一个 id 生成器。
 *
 * 状态（上一毫秒 + 当前随机段）挂在生成器上，所以同一个生成器连续调用才保证单调；
 * 每次新建一个就是每次从头抽随机段——**模块级单例是正确性要求，不是性能优化**。
 */
export declare function createIdGenerator(options?: IdGeneratorOptions): IdGenerator;
/** 生成下一个 id：26 位大写 Crockford Base32。 */
export declare function nextId(): string;
/** 生成下一个 id 的 16 字节形态。 */
export declare function nextIdBytes(): Uint8Array;
/** 生成下一个 id 的 UUIDv7 文本形态。 */
export declare function nextIdUuid(): string;
/**
 * 生成一个纯随机 id：26 位、不为猜测留时间前缀。
 *
 * 只给「id 本身就是凭据」的场景用（免鉴权的图片 URL、一次性下载链接）。普通主键、
 * 日志 rid、用户 id 都用 `nextId()`：那个带时间前缀，字典序即生成顺序。
 */
export declare function nextRandomId(): string;
/** 从 26 位 id 里读出毫秒时间戳（排障、测试用）。 */
export declare function parseId(id: string): {
    timeMs: number;
};
/** 26 位 id → UUIDv7 规范文本（写进 UUID 列、给外部系统）。 */
export declare function idToUuid(id: string): string;
//# sourceMappingURL=id.d.ts.map