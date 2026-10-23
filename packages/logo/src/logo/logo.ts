import { buildRecord } from "./record.js";
import { hasStdout } from "./sinks/stdout.js";
import { LEVELS, type Level, type LogRecord, type Sink } from "./types.js";

/** 默认 100ms 刷一次。服务端够用；客户端要按帧刷可设成 16~33。 */
const DEFAULT_FLUSH_INTERVAL_MS = 100;

/** 缓冲上限。达到就立刻 flush —— 用它兜住内存，而不是丢日志。 */
const DEFAULT_MAX_BUFFER = 10_000;

/** 栈帧里属于本库内部的行，采集时要剪掉，否则看到的全是自己的帧。 */
// 拆包后本库内部帧的路径是 `…/logo/src/logo/logo.ts` 或 `…/logo/dist/logo/logo.js`。
// 只匹配 `…/logo/(src|dist)/logo/…`，避免误伤用户自己的 src/logo/logo.ts。
const INTERNAL_FRAME = /[\\/]logo[\\/](?:src|dist)[\\/]logo[\\/](?:logo|record)\.[jt]s:/;

export interface LoggerOptions {
  level?: Level;
  name?: string;
  sinks?: Sink[];
  /** 注入时间，测试用。 */
  now?: () => number;
  flushIntervalMs?: number;
  maxBuffer?: number;
  /** 从哪个级别开始附带调用栈。默认 warn；设 "off" 关闭。 */
  stackLevel?: Level | "off";
  /** 是否启用定时批量。默认取决于能否同步写 stdout。 */
  batch?: boolean;
  /** 内部用：child 携带的固定字段。 */
  fields?: Record<string, unknown>;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(fields: Record<string, unknown> & { name?: string }): Logger;
  addSink(sink: Sink): void;
  removeSink(sink: Sink): void;
  setLevel(level: Level): void;
  flush(): void;
  dispose(): void;
}

/**
 * 捕获调用点。
 *
 * 第一行是 "Error" 头，后面是本库内部的帧，都要剪掉——留着只会让真正的
 * 调用点被埋在第 6 行。代价是每次 warn/error 构造一个 Error，因此只在
 * stackLevel 命中的级别上做。
 */
function captureStack(): string {
  const raw = new Error().stack ?? "";
  return raw
    .split("\n")
    .filter((line, index) => index === 0 || !INTERNAL_FRAME.test(line))
    .join("\n");
}

/** 父子 logger 共用同一个状态：父级 dispose 之后，子级也必须停。 */
interface LoggerState {
  disposed: boolean;
}

export function newLogger(options: LoggerOptions = {}): Logger {
  return buildLogger(options, { disposed: false });
}

function buildLogger(options: LoggerOptions, state: LoggerState): Logger {
  const now = options.now ?? Date.now;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const stackLevel = options.stackLevel ?? "error";
  const batch = options.batch ?? hasStdout();

  let level: Level = options.level ?? "info";
  let buffer: LogRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sinkReported = false;

  const sinks: Sink[] = [...(options.sinks ?? [])];
  const fixedFields = { ...options.fields };

  function reportSinkError(error: unknown): void {
    // 只提示一次：一条坏 sink 可能每 100ms 抛一次，刷屏比沉默更糟。
    if (sinkReported) return;
    sinkReported = true;
    console.error("[logo] sink 抛错，后续错误不再提示:", error);
  }

  function clearTimer(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function flush(): void {
    clearTimer();
    if (buffer.length === 0) return;

    // 整体换出：sink 里如果再写日志，不会掉进这次正在处理的批次里造成死循环。
    const outgoing = buffer;
    buffer = [];

    for (const sink of sinks) {
      try {
        sink(outgoing);
      } catch (error) {
        reportSinkError(error);
      }
    }
  }

  function schedule(): void {
    if (!batch || flushIntervalMs <= 0 || timer !== undefined) return;

    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, flushIntervalMs);

    // 不阻止进程退出：一批还没到期的日志不值得让服务挂着不关。
    const handle = timer as unknown as { unref?: () => void };
    handle.unref?.();
  }

  function emit(recordLevel: Level, args: readonly unknown[]): void {
    // dispose 之后静默丢弃：之前 stdout 还在写、文件 sink 已经丢了，行为不一致。
    if (state.disposed) return;
    if (LEVELS[recordLevel] < LEVELS[level]) return;

    const withStack = stackLevel !== "off" && LEVELS[recordLevel] >= LEVELS[stackLevel];
    const built = buildRecord(recordLevel, args, {
      name: options.name,
      stack: withStack ? captureStack() : undefined,
      time: now(),
    });

    // child 的固定字段在前、本次调用的字段在后：更具体的赢。
    const record =
      Object.keys(fixedFields).length > 0 ? { ...fixedFields, ...built } : built;

    buffer.push(record);

    // warn/error：先把积压的全部写出去，再写这一条。error 之后进程可能就没了，
    // 不能让之前的 info 卡在缓冲里。
    if (LEVELS[recordLevel] >= LEVELS.warn) {
      flush();
      return;
    }

    // 上限是内存保护，不是丢弃策略：写不下了就先冲一次。
    if (buffer.length >= maxBuffer) {
      flush();
      return;
    }

    // bugfix：batch:false 时 schedule() 什么都不做，原来的代码让 info 永远留在
    // 缓冲里，只有 warn / error 才顺带冲出去（Workers 默认走这条路，等于丢日志）。
    // 没有定时器兜底就得每条立刻写出。
    if (!batch) {
      flush();
      return;
    }

    schedule();
  }

  return {
    debug: (...args) => emit("debug", args),
    info: (...args) => emit("info", args),
    warn: (...args) => emit("warn", args),
    error: (...args) => emit("error", args),

    child(fields) {
      const { name, ...rest } = fields;
      return buildLogger({
        level,
        name: (name as string | undefined) ?? options.name,
        // 快照父级 sink：之后父级增删 sink 不影响已存在的子 logger。
        sinks: [...sinks],
        now,
        flushIntervalMs,
        maxBuffer,
        stackLevel,
        batch,
        fields: { ...fixedFields, ...rest },
      }, state);
    },

    addSink(sink) {
      sinks.push(sink);
    },

    removeSink(sink) {
      const index = sinks.indexOf(sink);
      if (index >= 0) sinks.splice(index, 1);
    },

    setLevel(next) {
      level = next;
    },

    flush,

    dispose() {
      state.disposed = true;
      clearTimer();
      flush();
      for (const sink of sinks) {
        const close = (sink as Sink & { close?: () => void }).close;
        if (typeof close !== "function") continue;
        try {
          close.call(sink);
        } catch (error) {
          reportSinkError(error);
        }
      }
    },
  };
}
