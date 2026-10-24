import { type Level, type Sink } from "../types.js";
export interface LarkSinkOptions {
    webhook: string;
    /** 群机器人开启"签名校验"时填。地址里的空串等同于没配。 */
    secret?: string;
    /**
     * 标题前缀，照 Go 版 logo 的 `NewLark(titlePrefix, token)`：
     * 一般写成 `DEV fly.server 192.168.31.182:8001`。
     */
    titlePrefix?: string;
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
    /**
     * 立即发一条，不进队列、不受 minLevel 与限流约束。
     *
     * 对应 Go 版 logo 的 `Lark.SendMessage`：启动通知这类"就一次"的消息
     * 不该为了绕过 error 级别把过滤关掉——那会把所有 info 都推出去。
     */
    notify(level: Level, title: string, text: string): Promise<void>;
    close(): void;
};
/**
 * 飞书群机器人 sink。
 *
 * 收到的已经是批量（logger 每 100ms 一次），这里再做一层窗口合并与限流：
 * 日志洪水时宁可少推几条，也不能把 webhook 打成 429 然后整片丢失。
 */
export declare function createLarkSink(options: LarkSinkOptions): LarkSink;
//# sourceMappingURL=lark.d.ts.map