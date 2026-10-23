import type { Level, LogRecord } from "./types.js";
interface Budget {
    nodes: number;
}
/**
 * 把任意值变成 JSON 安全的副本。
 *
 * 存在的理由：`buildRecord` 收到的对象会原样挂在记录上，而记录最终要被
 * `JSON.stringify`。如果调用方传了循环引用、BigInt、或者抛异常的 getter，
 * 序列化会失败——而那通常发生在进程崩溃前的最后一条日志上，正好是最不能丢的一条。
 *
 * 代价是每次写日志多一次遍历。日志对象通常很小，这个代价远小于丢日志的风险。
 */
export declare function sanitize(value: unknown, depth?: number, ancestors?: WeakSet<object>, budget?: Budget): unknown;
/** 序列化成字符串，失败时退回 `String(value)`。序列化本身永不抛。 */
export declare function safeStringify(value: unknown): string;
export interface BuildOptions {
    name?: string;
    stack?: string;
    /** 注入时间，测试用。默认 `Date.now()`。 */
    time?: number;
}
/**
 * 把一次调用的参数变成一条记录。
 *
 * 规则只有三条，因为规则多了没人记得住：
 *   1. 纯对象合并进字段（对象是数据）
 *   2. Error 展开成 message + stack
 *   3. 其余一切拼成 msg（用空格分隔，与 console 一致）
 *
 * 信封字段（time/level/msg/name/stack）最后写入，因此永远压过同名业务字段。
 */
export declare function buildRecord(level: Level, args: readonly unknown[], options?: BuildOptions): LogRecord;
export {};
