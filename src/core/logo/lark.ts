import { LEVELS, type Level, type Sink } from "./types.js";

const DEFAULT_BATCH_MS = 1000;
const DEFAULT_MAX_PER_MINUTE = 20;
/** 飞书单条消息上限 30KB，留出信封与转义的余量。 */
const MAX_TEXT_LENGTH = 18_000;

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

export type LarkSink = Sink & { flush(): Promise<void> };

function truncate(text: string): string {
  return text.length <= MAX_TEXT_LENGTH ? text : `${text.slice(0, MAX_TEXT_LENGTH)}…(截断)`;
}

async function sign(secret: string, timestamp: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${secret}`) as unknown as ArrayBuffer,
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * 飞书群机器人 sink。
 *
 * 收到的已经是批量（logger 每 100ms 一次），这里再做一层窗口合并与限流：
 * 日志洪水时宁可少推几条，也不能把 webhook 打成 429 然后整片丢失。
 */
export function createLarkSink(options: LarkSinkOptions): LarkSink {
  const batchMs = options.batchMs ?? DEFAULT_BATCH_MS;
  const maxPerMinute = options.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
  const minLevel = LEVELS[options.minLevel ?? "error"];
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tokens = maxPerMinute;
  let lastRefill = now();

  function refill(): void {
    const elapsed = now() - lastRefill;
    if (elapsed < 60_000) return;
    tokens = maxPerMinute;
    lastRefill = now();
  }

  async function send(lines: string[]): Promise<void> {
    if (lines.length === 0) return;

    const text = truncate(lines.join("\n"));
    const timestamp = String(Math.floor(now() / 1000));
    const body: Record<string, unknown> = { msg_type: "text", content: { text } };
    if (options.secret !== undefined) {
      body.timestamp = timestamp;
      body.sign = await sign(options.secret, Number(timestamp));
    }

    await doFetch(options.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (queue.length === 0) return;

    const pending = queue;
    queue = [];

    refill();
    if (tokens <= 0) return; // 超出配额：这一批直接丢，不排队堆积
    tokens -= 1;

    try {
      await send(pending);
    } catch {
      // 网络失败不该让业务日志调用抛错，也不重试——重试会把队列撑爆。
    }
  }

  const sink = ((batch) => {
    for (const record of batch) {
      if (LEVELS[record.level] < minLevel) continue;
      const detail = record.msg ?? "";
      queue.push(`[${record.level}] ${detail}`.trim());
    }

    if (queue.length > 0 && timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, batchMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  }) as LarkSink;

  sink.flush = flush;

  return sink;
}
