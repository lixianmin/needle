import { safeStringify } from "../core/logo/record.js";
/** 主题最短间隔。前端传什么都打不死进程。 */
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 60_000;
/** 注释心跳。反向代理会切断长时间无数据的连接，注释行不影响事件流。 */
const DEFAULT_HEARTBEAT_MS = 15_000;
function encodeEvent(event, data) {
    // JSON 里不会有裸换行，所以一条消息正好一行 data。
    return `event: ${event}\ndata: ${safeStringify(data)}\n\n`;
}
export function createBroadcast() {
    const connections = new Set();
    return {
        attach(connection) {
            connections.add(connection);
            return () => {
                connections.delete(connection);
            };
        },
        count() {
            return connections.size;
        },
        closeAll() {
            for (const connection of connections)
                connection.close();
            connections.clear();
        },
    };
}
/**
 * 解析 `?topics=top:5000,mem`。
 *
 * 未知名字直接忽略，而不是报错：前端拼错一个名字不值得让整条流失败。
 */
export function parseTopicSpecs(spec, topics) {
    if (spec === null || spec.trim() === "")
        return [];
    const specs = [];
    for (const part of spec.split(",")) {
        const [name, rawInterval] = part.split(":");
        const topic = topics.find((candidate) => candidate.name === name?.trim());
        if (topic === undefined)
            continue;
        const requested = rawInterval === undefined ? topic.intervalMs : Number(rawInterval);
        const intervalMs = Number.isFinite(requested)
            ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, requested))
            : topic.intervalMs;
        specs.push({ topic, intervalMs });
    }
    return specs;
}
/**
 * 建立一条 SSE 流。
 *
 * 生命周期只有一个出口：读端 cancel（浏览器断开）时，清掉所有定时器并从
 * broadcast 摘除。漏掉任何一条，进程里就多一个永远跑着的 interval。
 */
export function createSseResponse(init) {
    const encoder = new TextEncoder();
    const heartbeatMs = init.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const specs = parseTopicSpecs(init.topicSpec ?? null, init.topics);
    let closed = false;
    let detach;
    const timers = [];
    const stream = new ReadableStream({
        start(controller) {
            let lastWrite = Date.now();
            const write = (chunk) => {
                if (closed)
                    return;
                try {
                    controller.enqueue(encoder.encode(chunk));
                    lastWrite = Date.now();
                }
                catch {
                    closed = true;
                }
            };
            const connection = {
                send(event, data) {
                    write(encodeEvent(event, data));
                },
                close() {
                    if (closed)
                        return;
                    closed = true;
                    try {
                        controller.close();
                    }
                    catch {
                        // 已经关过了。
                    }
                },
            };
            detach = init.broadcast.attach(connection);
            connection.send("handshake", {
                title: init.title,
                version: init.version,
                user: init.user,
                commands: init.commands.map((command) => ({
                    name: command.name,
                    note: command.note,
                    args: command.args ?? null,
                })),
                topics: init.topics.map((topic) => ({
                    name: topic.name,
                    note: topic.note,
                    intervalMs: topic.intervalMs,
                })),
            });
            for (const { topic, intervalMs } of specs) {
                let busy = false;
                timers.push(setInterval(() => {
                    // 慢主题不叠加：上一轮没读完就跳过这一轮，否则连接会被越堆越多的
                    // 读取任务拖死。
                    if (busy)
                        return;
                    busy = true;
                    Promise.resolve()
                        .then(() => topic.read())
                        .then((data) => connection.send("topic", { name: topic.name, data }))
                        .catch((error) => {
                        // 主题读失败不该把整条流拖死，推一条错误说明就够了。
                        connection.send("topic", { name: topic.name, error: String(error) });
                    })
                        .finally(() => {
                        busy = false;
                    });
                }, intervalMs));
            }
            // 只在真正空闲时才发注释心跳：有日志或主题在推的时候不需要它。
            // 中间层（nginx 默认 60s、多数负载均衡 30s）按"无数据"计算超时，
            // 这一行是给它们看的，控制台里不会显示。
            timers.push(setInterval(() => {
                if (Date.now() - lastWrite < heartbeatMs)
                    return;
                write(": ping\n\n");
            }, heartbeatMs));
            for (const timer of timers)
                timer.unref?.();
        },
        cancel() {
            closed = true;
            for (const timer of timers)
                clearInterval(timer);
            timers.length = 0;
            detach?.();
            detach = undefined;
        },
    });
    return new Response(stream, {
        headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
        },
    });
}
