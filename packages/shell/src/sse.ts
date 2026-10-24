import { safeStringify } from "@needle/logo";
import type { LogRecord, Sink } from "@needle/logo";
import type { Command, Topic } from "./types.js";

/** 主题最短间隔。前端传什么都打不死进程。 */
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 60_000;

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
export const DEFAULT_HEARTBEAT_MS = 2_000;

/** 单条连接最多订阅多少个主题：`?topics=` 每条约 6 字节，16KB 的头能塞进几千个。 */
const MAX_TOPIC_SPECS = 16;

/** 单帧最多带多少条日志。一次 flush 可能上千条，切成小帧客户端才跟得上。 */
const MAX_LOG_FRAME = 200;

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

function encodeEvent(event: string, data: unknown): string {
  // JSON 里不会有裸换行，所以一条消息正好一行 data。
  return `event: ${event}\ndata: ${safeStringify(data)}\n\n`;
}

export function createBroadcast(): Broadcast {
  const connections = new Set<Connection>();

  return {
    sink(batch) {
      if (connections.size === 0) {
        return;
      }

      // 不过滤级别：logger 已经按自己的 level 过滤过了，这里原样转发。
      for (let start = 0; start < batch.length; start += MAX_LOG_FRAME) {
        const frame: LogRecord[] = batch.slice(start, start + MAX_LOG_FRAME);
        // 编码一次、所有连接共用；连接多时这一条决定 CPU 是 O(1) 还是 O(N)。
        const text = encodeEvent("log", frame);

        for (const connection of connections) {
          try {
            if (connection.sendText === undefined) {
              connection.send("log", frame);
            } else {
              connection.sendText(text);
            }
          } catch {
            // 写不进去说明连接已经坏了，摘掉即可，不能让一条坏连接影响其他连接。
            connections.delete(connection);
          }
        }
      }
    },

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
      for (const connection of connections) {
        connection.close();
      }
      connections.clear();
    },
  };
}

export interface TopicSpec {
  topic: Topic;
  intervalMs: number;
}

/**
 * 解析 `?topics=top:5000,mem`。
 *
 * 未知名字直接忽略，而不是报错：前端拼错一个名字不值得让整条流失败。
 */
export function parseTopicSpecs(spec: string | null, topics: readonly Topic[]): TopicSpec[] {
  if (spec === null || spec.trim() === "") {
    return [];
  }

  const specs: TopicSpec[] = [];
  const seen = new Set<string>();
  for (const part of spec.split(",")) {
    if (specs.length >= MAX_TOPIC_SPECS) {
      break;
    }
    const [name, rawInterval] = part.split(":");
    const trimmed = name?.trim() ?? "";
    const topic = topics.find((candidate) => candidate.name === trimmed);
    // 去重：同一个名字重复出现会重复建 interval，一条 URL 就能压满事件循环。
    if (topic === undefined || seen.has(topic.name)) {
      continue;
    }
    seen.add(topic.name);

    const requested = rawInterval === undefined ? topic.intervalMs : Number(rawInterval);
    const intervalMs = Number.isFinite(requested)
      ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, requested))
      : topic.intervalMs;

    specs.push({ topic, intervalMs });
  }
  return specs;
}

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
export function createSseResponse(init: SseInit): Response {
  const encoder = new TextEncoder();
  const heartbeatMs = init.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const specs = parseTopicSpecs(init.topicSpec ?? null, init.topics);

  let closed = false;
  let detach: (() => void) | undefined;
  const timers: ReturnType<typeof setInterval>[] = [];

  /** 唯一的清理出口：定时器不清，连接关了也还在每秒读主题。 */
  function teardown(): void {
    closed = true;
    for (const timer of timers) {
      clearInterval(timer);
    }
    timers.length = 0;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 唯一还绕开 teardown 的出口：不清定时器的话连接关了还在每秒读主题。
          teardown();
          detach?.();
          detach = undefined;
        }
      };

      const connection: Connection = {
        send(event, data) {
          write(encodeEvent(event, data));
        },
        sendText(text) {
          write(text);
        },
        close() {
          if (closed) {
            return;
          }
          teardown();
          try {
            controller.close();
          } catch {
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
        timers.push(
          setInterval(() => {
            if (closed) {
              return;
            }
            // 慢主题不叠加：上一轮没读完就跳过这一轮，否则连接会被越堆越多的
            // 读取任务拖死。
            if (busy) {
              return;
            }
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
          }, intervalMs),
        );
      }

      // 无条件发，不做「空闲才发」：跳过逻辑会把实际间隔抖动到 2×heartbeatMs
      //（tick 前脚刚写过就整轮不发），正好落到 Bun 的 10 秒 idleTimeout 上。
      // 中间层（nginx 默认 60s、多数负载均衡 30s）与 Bun 都按「无数据」计时。
      timers.push(
        setInterval(() => {
          if (closed) {
            return;
          }
          write(": ping\n\n");
        }, heartbeatMs),
      );
      for (const timer of timers) {
        (timer as unknown as { unref?: () => void }).unref?.();
      }
    },

    cancel() {
      teardown();
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
