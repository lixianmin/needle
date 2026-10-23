import type { Sink } from "@needle/logo";
import type { Command, Topic } from "./types.js";
export interface Connection {
    send(event: string, data: unknown): void;
    close(): void;
}
export interface Broadcast {
    /** 作为 sink 挂在 logger 上：把日志切成小帧推给每条连接。 */
    sink: Sink;
    attach(connection: Connection): () => void;
    count(): number;
    closeAll(): void;
}
export declare function createBroadcast(): Broadcast;
export interface TopicSpec {
    topic: Topic;
    intervalMs: number;
}
/**
 * 解析 `?topics=top:5000,mem`。
 *
 * 未知名字直接忽略，而不是报错：前端拼错一个名字不值得让整条流失败。
 */
export declare function parseTopicSpecs(spec: string | null, topics: readonly Topic[]): TopicSpec[];
export interface SseInit {
    user: string;
    title: string;
    version: string;
    commands: readonly Command[];
    topics: readonly Topic[];
    topicSpec?: string | null;
    broadcast: Broadcast;
    heartbeatMs?: number;
}
/**
 * 建立一条 SSE 流。
 *
 * 生命周期只有一个出口：读端 cancel（浏览器断开）时，清掉所有定时器并从
 * broadcast 摘除。漏掉任何一条，进程里就多一个永远跑着的 interval。
 */
export declare function createSseResponse(init: SseInit): Response;
