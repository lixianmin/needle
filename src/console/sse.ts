import { safeStringify } from "../core/record.js";
import type { Sink } from "../core/types.js";
import type { Command, Topic } from "./types.js";

/** 主题最短间隔。前端传什么都打不死进程。 */
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 60_000;

/** 注释心跳。反向代理会切断长时间无数据的连接，注释行不影响事件流。 */
const DEFAULT_HEARTBEAT_MS = 15_000;

export interface Connection {
  send(event: string, data: unknown): void;
  close(): void;
}

export interface Broadcast {
  /** 作为 sink 挂在 logger 上，把实时日志推给所有连接。 */
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
      if (connections.size === 0) return;
      for (const record of batch) {
        for (const connection of connections) {
          try {
            connection.send("log", record);
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
      for (const connection of connections) connection.close();
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
  if (spec === null || spec.trim() === "") return [];

  const specs: TopicSpec[] = [];
  for (const part of spec.split(",")) {
    const [name, rawInterval] = part.split(":");
    const topic = topics.find((candidate) => candidate.name === name?.trim());
    if (topic === undefined) continue;

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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const connection: Connection = {
        send(event, data) {
          write(encodeEvent(event, data));
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // 已经关过了。
          }
        },
      };

      detach = init.broadcast.attach(connection);

      connection.send("hello", {
        version: init.version,
        user: init.user,
        commands: init.commands.map((command) => ({
          name: command.name,
          note: command.note,
          args: command.args ?? null,
        })),
      });

      for (const { topic, intervalMs } of specs) {
        timers.push(
          setInterval(() => {
            try {
              connection.send("topic", { name: topic.name, data: topic.read() });
            } catch (error) {
              // 主题读失败不该把整条流拖死，推一条错误说明就够了。
              connection.send("topic", { name: topic.name, error: String(error) });
            }
          }, intervalMs),
        );
      }

      timers.push(setInterval(() => write(": ping\n\n"), heartbeatMs));
      for (const timer of timers) (timer as unknown as { unref?: () => void }).unref?.();
    },

    cancel() {
      closed = true;
      for (const timer of timers) clearInterval(timer);
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
