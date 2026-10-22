import { type Level, type Sink } from "../types.js";
export interface LarkSinkOptions {
    webhook: string;
    /** 群机器人开启"签名校验"时填。 */
    secret?: string;
    /** 低于这个级别不推送，默认 error。 */
    minLevel?: Level;
    /** 合并窗口，默认 1 秒。 */
    batchMs?: number;
    /** 每分钟最多推几条，默认 20（飞书自定义机器人的常见限额）。 */
    maxPerMinute?: number;
    fetch?: typeof fetch;
    now?: () => number;
}
export type LarkSink = Sink & {
    flush(): Promise<void>;
};
/**
 * 飞书群机器人 sink。
 *
 * 收到的已经是批量（logger 每 100ms 一次），这里再做一层窗口合并与限流：
 * 日志洪水时宁可少推几条，也不能把 webhook 打成 429 然后整片丢失。
 */
export declare function createLarkSink(options: LarkSinkOptions): LarkSink;
