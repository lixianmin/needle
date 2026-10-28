import { buildRecord, sanitize } from "./record.js";
import { hasStdout } from "./sinks/stdout.js";
import { LEVELS, type Level, type LogRecord, type Sink } from "./types.js";

/** 默认 100ms 刷一次。服务端够用；客户端要按帧刷可设成 16~33。 */
const DEFAULT_FLUSH_INTERVAL_MS = 100;

/** 缓冲上限。达到就立刻 flush —— 用它兜住内存，而不是丢日志。 */
const DEFAULT_MAX_BUFFER = 10_000;

/** V8 帧：`    at fn (/a/b/file.ts:12:34)` 或 `    at /a/b/file.ts:12:34`。 */
// Stryker disable next-line Regex: `\s+(` 收成一个空格是等价变体——前面的 `(.*?)` 是惰性的，会把多出来的空格吃掉；正则本身由 frames.test.ts 逐个格式钉住
const FRAME_PATTERN = /^\s+at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;

interface Frame {
  file: string;
}

/**
 * 从一行栈帧里取出文件路径。
 *
 * 导出是为了能拿合成帧做测试：真栈的格式由运行时决定，凑不出「无函数名」「Windows
 * 反斜杠」这些边角，而它们恰恰是这里的分支。
 */
export function parseFrame(line: string): Frame | undefined {
  const match = FRAME_PATTERN.exec(line);
  const file = match?.[2];
  if (file === undefined || file === "") {
    return undefined;
  }

  return { file };
}

/** 取目录部分。没有分隔符时返回空串（相对文件名没有「所在目录」）。 */
function dirOf(file: string): string {
  const index = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  // Stryker disable next-line EqualityOperator: index 只会是 -1 或 ≥0，`<= 0` 与 `< 0` 在这里同解
  // Stryker disable next-line StringLiteral: 非空串在这条路径上没有意义——它拼出来的前缀不会命中任何真实帧，与返回 "" 同解
  return index < 0 ? "" : file.slice(0, index);
}

/**
 * 剪掉与 `originFile` 同目录的所有帧。
 *
 * 同样导出给测试：拿合成帧就能覆盖「同一目录」「子目录」「反斜杠」这几条路径。
 */
export function pruneInternalFrames(frames: readonly string[], originFile: string): string[] {
  const dir = dirOf(originFile);
  if (dir === "") {
    return [...frames];
  }

  // Windows 的栈里是反斜杠，两种分隔符都试。
  return frames.filter((line) => !line.includes(`${dir}/`) && !line.includes(`${dir}\\`));
}

/**
 * 剪掉本库内部的栈帧，只留调用方的。
 *
 * 不写死路径：本库的目录搬过几次，每搬一次固定正则就失效一次，症状是栈里冒出
 * 自己。改成拿第一帧（本函数所在文件）的目录当基准——同一目录下的帧都是内部帧，
 * 与目录布局无关。
 */
function externalFrames(): string[] {
  // Stryker disable next-line StringLiteral: `?? ""` 是护栏——V8/JSC/SpiderMonkey 的 Error.stack 恒为字符串
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  // Stryker disable next-line StringLiteral: 同上，split 至少产出一个元素，这个兜底用不到
  const origin = parseFrame(frames[0] ?? "");
  // Stryker disable next-line ConditionalExpression,BlockStatement: 真栈的第一帧永远是一条 `at …` 帧，这条分支在真实输入下走不到
  if (origin === undefined) {
    return frames;
  }

  return pruneInternalFrames(frames, origin.file);
}

/** 完整调用栈：只有达到 stackLevel 的级别才带上，头一行保留 "Error"。 */
function stackOf(frames: readonly string[]): string {
  return ["Error", ...frames].join("\n");
}

export interface LoggerOptions {
  /** 低于这个级别不记录。默认 "info"。 */
  level?: Level;
  /** logger 的名字，写进每条记录的 name 字段。默认不出现。 */
  name?: string;
  /** 初始 sink 列表。默认空——`@needle/logo` 根入口的 `logo` 实例才挂了 stdout。 */
  sinks?: Sink[];
  /** 注入时间，测试用。 */
  now?: () => number;
  /** 攒批窗口（毫秒）。默认 100；客户端想按帧刷可设成 16~33。 */
  flushIntervalMs?: number;
  /** 缓冲上限（条）。默认 10000；写满立刻 flush，不丢记录。 */
  maxBuffer?: number;
  /**
   * 从哪个级别开始采集**完整**调用栈。默认 "error"；设 "off" 关闭全栈。
   *
   * 调用点（`site`/`fn`）不再逐条抓：打包后栈里报的是 bundle 坐标，付了代价
   * 拿不到结果。要定位就手写 `module`（`logo.child({ module })`）或 `traceOf(ctx)`。
   */
  stackLevel?: Level | "off";
  /** 是否启用定时批量。默认取决于能否同步写 stdout。 */
  batch?: boolean;
  /** 内部用：child 携带的固定字段。 */
  fields?: Record<string, unknown>;
}

export interface Logger {
  /** 记一条 debug。参数规则见 {@link Logger.info}。 */
  debug(...args: unknown[]): void;
  /**
   * 记一条 info。四个级别方法的参数规则一样：
   *
   *   - **纯对象**（原型是 `Object.prototype` 或 `null`）→ 自有字段铺在记录顶层
   *   - **`Error`** → 展开成 `message` + `stack` 两个字段
   *   - **其余**（字符串、数字、数组、`Date`、类实例……）→ 序列化后拼进 `msg`
   *
   * `time` / `level` / `msg` / `name` 是保留字段：业务对象里的同名键会被丢弃，
   * 信封值永远赢。`name` 只能由 `child({ name })` 设置。
   */
  info(...args: unknown[]): void;
  /** 记一条 warn。和 info 一样攒批，但会立即写出，并把积压一起带出去。 */
  warn(...args: unknown[]): void;
  /** 记一条 error。立即写出，并把积压一起带出去。只有它默认带调用栈。 */
  error(...args: unknown[]): void;
  /**
   * 派生一个 logger：`fields` 里的固定字段带进它的每条记录，`name` 单独写进
   * 记录的 name 字段。
   *
   * 子 logger 在创建时**快照**父级的 sink 列表——之后给父级 `addSink`，子 logger
   * 收不到。要统一落点，就在启动早期建 child，或直接给 child 挂 sink。
   */
  child(fields: Record<string, unknown> & { name?: string }): Logger;
  /** 挂一个 sink。sink 一次收到一批记录，不是一条一条。 */
  addSink(sink: Sink): void;
  /** 摘掉一个 sink。 */
  removeSink(sink: Sink): void;
  /** 改级别。低于新级别的记录直接丢弃。 */
  setLevel(level: Level): void;
  /**
   * 立刻把缓冲区写出去。
   *
   * info 默认攒批 100ms 才写——测试里断言 sink 收到的记录之前，必须先 flush 一次。
   */
  flush(): void;
  /**
   * 冲掉缓冲 + 关掉定时器 + 调用 sink 的 close（如果有）。
   *
   * 调用之后（含子 logger，因为父子共用状态）日志静默丢弃。进程退出前调一次。
   */
  dispose(): void;
}

/** 父子 logger 共用同一个状态：父级 dispose 之后，子级也必须停。 */
/**
 * 一个 logger 家族共享的状态：`disposed`、缓冲、定时器。
 *
 * `child()` 返回的是新实例（各自的 level / fields / sink 快照），但它们必须共用
 * 同一份 buffer 和同一个 timer，否则父 `flush()` / `dispose()` 带不走子缓冲：
 * 退出前调一次 `dispose()` 会让子 logger 缓冲里最后一批记录永久丢失，
 * 而子的定时器在 dispose 之后还会照常把记录写出去。
 */
interface LoggerState {
  disposed: boolean;
  buffer: LogRecord[];
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function newLogger(options: LoggerOptions = {}): Logger {
  return buildLogger(options, { disposed: false, buffer: [], timer: undefined });
}

function buildLogger(options: LoggerOptions, state: LoggerState): Logger {
  const now = options.now ?? Date.now;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const stackLevel = options.stackLevel ?? "error";
  const batch = options.batch ?? hasStdout();

  let level: Level = options.level ?? "info";
  let sinkReported = false;

  const sinks: Sink[] = [...(options.sinks ?? [])];
  // child 的固定字段会被展开进每条记录，所以必须和 buildRecord 走同一套 sanitize：
  // 否则 child({ cb: () => {} }) 会让该 child 的每一条记录都不可被 sink 序列化
  // （IDB 的 put 直接抛 DataCloneError，整批写不进去）。
  const fixedFields = (sanitize(options.fields ?? {}) ?? {}) as Record<string, unknown>;

  function reportSinkError(error: unknown): void {
    // 只提示一次：一条坏 sink 可能每 100ms 抛一次，刷屏比沉默更糟。
    if (sinkReported) {
      return;
    }

    sinkReported = true;
    console.error("[logo] sink 抛错，后续错误不再提示:", error);
  }

  function clearTimer(): void {
    if (state.timer === undefined) {
      return;
    }

    clearTimeout(state.timer);
    state.timer = undefined;
  }

  function flush(): void {
    clearTimer();
    if (state.buffer.length === 0) {
      return;
    }

    // 整体换出：sink 里如果再写日志，不会掉进这次正在处理的批次里造成死循环。
    const outgoing = state.buffer;
    state.buffer = [];

    for (const sink of sinks) {
      try {
        sink(outgoing);
      } catch (error) {
        reportSinkError(error);
      }
    }
  }

  function schedule(): void {
    if (!batch || flushIntervalMs <= 0 || state.timer !== undefined) {
      return;
    }

    state.timer = setTimeout(() => {
      state.timer = undefined;
      flush();
    }, flushIntervalMs);

    // 不阻止进程退出：一批还没到期的日志不值得让服务挂着不关。
    const handle = state.timer as unknown as { unref?: () => void };
    handle.unref?.();
  }

  function emit(recordLevel: Level, args: readonly unknown[]): void {
    // dispose 之后静默丢弃：之前 stdout 还在写、文件 sink 已经丢了，行为不一致。
    if (state.disposed) {
      return;
    }

    if (LEVELS[recordLevel] < LEVELS[level]) {
      return;
    }

    // Stryker disable next-line StringLiteral,ConditionalExpression: `LEVELS["off"]` 是 undefined，比较恒为 false——"off" 这个守卫只为省掉那次查表，等价
    const withStack = stackLevel !== "off" && LEVELS[recordLevel] >= LEVELS[stackLevel];
    // 只有要完整栈时才构造 Error（一次取帧）。info / warn / debug 零构造。
    const frames = withStack ? externalFrames() : undefined;
    const built = buildRecord(recordLevel, args, {
      name: options.name,
      stack: frames === undefined ? undefined : stackOf(frames),
      time: now(),
    });

    // child 的固定字段在前、本次调用的字段在后：更具体的赢。
    const record =
      // Stryker disable next-line ConditionalExpression,EqualityOperator: 空固定字段时展开成新对象只是多一次拷贝，记录内容与 identity 都不对外暴露（等价变体）
      Object.keys(fixedFields).length > 0 ? { ...fixedFields, ...built } : built;

    state.buffer.push(record);

    // warn/error：先把积压的全部写出去，再写这一条。error 之后进程可能就没了，
    // 不能让之前的 info 卡在缓冲里。
    if (LEVELS[recordLevel] >= LEVELS.warn) {
      flush();
      return;
    }

    // 上限是内存保护，不是丢弃策略：写不下了就先冲一次。
    if (state.buffer.length >= maxBuffer) {
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
      if (index >= 0) {
        sinks.splice(index, 1);
      }
    },

    setLevel(next) {
      level = next;
    },

    flush,

    dispose() {
      state.disposed = true;
      // Stryker disable next-line CallExpression: 排着的定时器必然对应非空缓冲，紧接着的 flush() 会自己清掉它（等价变体）
      clearTimer();
      flush();
      for (const sink of sinks) {
        const close = (sink as Sink & { close?: () => void }).close;
        if (typeof close !== "function") {
          continue;
        }

        try {
          close.call(sink);
        } catch (error) {
          reportSinkError(error);
        }
      }
    },
  };
}
