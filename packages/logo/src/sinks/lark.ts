import { LEVELS, type Level, type LogRecord, type Sink } from "../types.js";
import { formatTime } from "../line.js";

const DEFAULT_BATCH_MS = 1000;
const DEFAULT_MAX_PER_MINUTE = 20;
/** 飞书单条消息上限 30KB；按 UTF-8 字节算，给信封和 JSON 转义留 6KB 余量。 */
const MAX_TEXT_BYTES = 24_000;

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

/** 级别名照 Go 版 logo 的 `ding.GetLevelName`：首字母大写。 */
const LEVEL_NAMES: Record<Level, string> = {
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
};

function truncate(text: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= MAX_TEXT_BYTES) {
    return text;
  }

  // 按字节累加而不是按字符数：18000 个汉字是 54KB，飞书会直接拒收。
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > MAX_TEXT_BYTES) {
      break;
    }
    bytes += size;
    end += char.length;
  }
  return `${text.slice(0, end)}…(截断)`;
}

/** 一条记录能给人看的部分：msg、Error 的 message、栈。 */
function detailOf(record: LogRecord): string {
  const parts: string[] = [];
  if (record.msg !== undefined && record.msg !== "") {
    parts.push(record.msg);
  }
  if (typeof record.message === "string" && record.message !== "") {
    parts.push(record.message);
  }
  if (typeof record.stack === "string" && record.stack !== "") {
    parts.push(record.stack);
  }
  return parts.join("\n");
}

/**
 * 消息标题，照 Go 版 logo 的格式：`[<Level>(<batch>) <titlePrefix>] <title>`。
 *
 * `(batch)` 是这条消息合并了多少条记录（单发就是 1），一眼能看出刚才刷了多少。
 */
function titleOf(level: Level, batch: number, prefix: string, title: string): string {
  const name = LEVEL_NAMES[level];
  const head = prefix === "" ? `[${name}(${batch})]` : `[${name}(${batch}) ${prefix}]`;
  return title === "" ? head : `${head} ${title}`;
}

function highestLevel(levels: readonly Level[]): Level {
  let top: Level = "debug";
  for (const level of levels) {
    if (LEVELS[level] > LEVELS[top]) {
      top = level;
    }
  }
  return top;
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
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte);
  }
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
  // `secret: ""`（配置里留空）等同于没配：空字符串作为 HMAC key 进 WebCrypto 会抛
  // `DataError: Zero-length key is not supported`，而 send 的失败在 flush 里被静默
  // 吞掉——告警一条都发不出去，还没有任何提示。
  const secret = options.secret === undefined || options.secret === "" ? undefined : options.secret;

  let queue: Array<{ level: Level; text: string }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let tokens = maxPerMinute;
  let lastRefill = now();

  function refill(): void {
    const at = now();
    const elapsed = at - lastRefill;
    if (elapsed <= 0) {
      return;
    }

    // 按时间比例补充，而不是每满 60 秒整桶重置：后者允许在窗口边界连发
    // 2× 配额，正好是限流要防的情况。
    lastRefill = at;
    tokens = Math.min(maxPerMinute, tokens + (elapsed / 60_000) * maxPerMinute);
  }

  async function post(level: Level, batch: number, text: string, title: string): Promise<void> {
    if (text === "") {
      return;
    }

    const timestamp = String(Math.floor(now() / 1000));
    const body: Record<string, unknown> = {
      // 用 post 而不是 text：飞书里 post 才带标题行，才看得出级别与来源。
      // 结构照 Go 版 logo 的 `lark/internal/message.go`。
      msg_type: "post",
      content: {
        post: {
          zh_cn: {
            title: titleOf(level, batch, options.titlePrefix ?? "", title),
            // 末尾那行发送时间也是 Go 版的写法：一眼知道这批是多久之前发的。
            content: [[{ tag: "text", text: truncate(`${text}\n${formatTime(now())}`) }]],
          },
        },
      },
    };
    if (secret !== undefined) {
      body.timestamp = timestamp;
      body.sign = await sign(secret, Number(timestamp));
    }

    const response = await doFetch(options.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // 静默失败等于告警没发出去：至少留一行到 stderr。
    if (!response.ok) {
      console.error(`[logo] lark webhook 返回 HTTP ${response.status}`);
    }
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (queue.length === 0) {
      return;
    }

    const pending = queue;
    queue = [];

    refill();
    if (tokens < 1) {
      return; // 超出配额：这一批直接丢，不排队堆积
    }
    tokens -= 1;

    try {
      await post(highestLevel(pending.map((item) => item.level)), pending.length, pending.map((item) => item.text).join("\n"), "");
    } catch {
      // 网络失败不该让业务日志调用抛错，也不重试——重试会把队列撑爆。
    }
  }

  const sink = ((batch) => {
    if (closed) {
      return;
    }
    for (const record of batch) {
      if (LEVELS[record.level] < minLevel) {
        continue;
      }
      queue.push({ level: record.level, text: `[${record.level}] ${detailOf(record)}`.trim() });
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
  sink.notify = async (level, title, text) => {
    refill();
    if (tokens < 1) {
      return; // 超出配额：启动通知也不该绕过飞书自己的限流
    }
    tokens -= 1;
    try {
      await post(level, 1, text, title);
    } catch {
      // 启动通知发不出去不该拦住进程启动。
    }
  };
  // dispose() 只调用带 close 的 sink。没有它，队列里最后一条 error 会随进程消失。
  sink.close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    // best-effort：dispose 是同步的，进程若紧接着 exit，这次发送可能来不及完成。
    void flush();
  };

  return sink;
}
