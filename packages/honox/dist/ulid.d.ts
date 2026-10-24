/**
 * ULID：26 位 Crockford Base32。
 *
 * 前 10 位是毫秒时间戳（48 bit，够用到 10889 年），后 16 位是 80 bit 随机数。
 * 相比 UUID v4 的好处是可排序、能直接看出生成时间，而且定长 26 字符。
 *
 * 同一个毫秒里生成的两个 ULID 不保证有序（要实现单调版得在模块里存上一笔状态，
 * 请求 id 用不上这个性质）。
 */
/** 生成一个 ULID。`now` 只为测试注入时间用。 */
export declare function ulid(now?: number): string;
/** 判断入站请求带来的 id 是不是 ULID。 */
export declare function isUlid(value: string): boolean;
//# sourceMappingURL=ulid.d.ts.map