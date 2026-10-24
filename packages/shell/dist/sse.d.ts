import type { Sink } from "@needle/logo";
import type { Command, Topic } from "./types.js";
/**
 * 注释心跳间隔（注释行不影响事件流，Shell 里不显示）。
 *
 * 必须短于链路上最短的「无数据即断开」超时。最短的那一个是应用服务器自己：
 * `Bun.serve()` 的 HTTP `idleTimeout` 默认 10 秒（bun-types:
 * HostnamePortServeOptions.idleTimeout），比 nginx 的 60 秒、多数负载均衡的 30 秒
 * 都短。2 秒留 5 倍余量，代价是每个打开的面板每 2 秒 8 字节。
 *
 * 实测：Bun 1.4.4 + 默认 idleTimeout + 15 秒心跳，连接在第 10 秒被掐，
 * 客户端拿到 ECONNRESET。
 */
export declare const DEFAULT_HEARTBEAT_MS = 2000;
export interface Connection {
    send(event: string, data: unknown): void;
    /**
     * 已经编码好的帧。多连接时同一帧只序列化一次——几十条连接各自
     * `JSON.stringify` 一遍是这条链路最大的 CPU 开销。
     */
    sendText?(text: string): void;
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
//# sourceMappingURL=sse.d.ts.map