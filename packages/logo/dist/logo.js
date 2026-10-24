import { buildRecord } from "./record.js";
import { hasStdout } from "./sinks/stdout.js";
import { LEVELS } from "./types.js";
/** 默认 100ms 刷一次。服务端够用；客户端要按帧刷可设成 16~33。 */
const DEFAULT_FLUSH_INTERVAL_MS = 100;
/** 缓冲上限。达到就立刻 flush —— 用它兜住内存，而不是丢日志。 */
const DEFAULT_MAX_BUFFER = 10_000;
/** V8 帧：`    at fn (/a/b/file.ts:12:34)` 或 `    at /a/b/file.ts:12:34`。 */
const FRAME_PATTERN = /^\s+at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;
function parseFrame(line) {
    const match = FRAME_PATTERN.exec(line);
    const file = match?.[2];
    const lineText = match?.[3];
    if (file === undefined || file === "" || lineText === undefined) {
        return undefined;
    }
    return { file, line: Number(lineText), fn: match?.[1] ?? "" };
}
/** 只取文件名：与 Go 版 logo 的 FlagShortFile 同口径。不引 node:path，浏览器侧也要跑。 */
function basename(file) {
    const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
    return slash < 0 ? file : file.slice(slash + 1);
}
/**
 * 剪掉本库内部的栈帧，只留调用方的。
 *
 * 不写死路径：本库的目录搬过几次，每搬一次固定正则就失效一次，症状是栈里冒出
 * 自己。改成拿第一帧（本函数所在文件）的目录当基准——同一目录下的帧都是内部帧，
 * 与目录布局无关。
 */
function externalFrames() {
    const frames = (new Error().stack ?? "").split("\n").slice(1);
    const origin = parseFrame(frames[0] ?? "");
    if (origin === undefined) {
        return frames;
    }
    const file = origin.file;
    const dir = file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")));
    if (dir === "") {
        return frames;
    }
    // Windows 的栈里是反斜杠，两种分隔符都试。
    return frames.filter((line) => !line.includes(`${dir}/`) && !line.includes(`${dir}\\`));
}
/** 调用点：`file.ts:12`。每条日志都要，所以每写一条构造一次 Error，这是明码代价。 */
function callSiteOf(frames) {
    const frame = parseFrame(frames[0] ?? "");
    return frame === undefined ? undefined : `${basename(frame.file)}:${frame.line}`;
}
function functionOf(frames) {
    return parseFrame(frames[0] ?? "")?.fn;
}
/** 完整调用栈：只有达到 stackLevel 的级别才带上，头一行保留 "Error"。 */
function stackOf(frames) {
    return ["Error", ...frames].join("\n");
}
export function newLogger(options = {}) {
    return buildLogger(options, { disposed: false });
}
function buildLogger(options, state) {
    const now = options.now ?? Date.now;
    const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const stackLevel = options.stackLevel ?? "error";
    const batch = options.batch ?? hasStdout();
    let level = options.level ?? "info";
    let buffer = [];
    let timer;
    let sinkReported = false;
    const sinks = [...(options.sinks ?? [])];
    const fixedFields = { ...options.fields };
    function reportSinkError(error) {
        // 只提示一次：一条坏 sink 可能每 100ms 抛一次，刷屏比沉默更糟。
        if (sinkReported) {
            return;
        }
        sinkReported = true;
        console.error("[logo] sink 抛错，后续错误不再提示:", error);
    }
    function clearTimer() {
        if (timer === undefined) {
            return;
        }
        clearTimeout(timer);
        timer = undefined;
    }
    function flush() {
        clearTimer();
        if (buffer.length === 0) {
            return;
        }
        // 整体换出：sink 里如果再写日志，不会掉进这次正在处理的批次里造成死循环。
        const outgoing = buffer;
        buffer = [];
        for (const sink of sinks) {
            try {
                sink(outgoing);
            }
            catch (error) {
                reportSinkError(error);
            }
        }
    }
    function schedule() {
        if (!batch || flushIntervalMs <= 0 || timer !== undefined) {
            return;
        }
        timer = setTimeout(() => {
            timer = undefined;
            flush();
        }, flushIntervalMs);
        // 不阻止进程退出：一批还没到期的日志不值得让服务挂着不关。
        const handle = timer;
        handle.unref?.();
    }
    function emit(recordLevel, args) {
        // dispose 之后静默丢弃：之前 stdout 还在写、文件 sink 已经丢了，行为不一致。
        if (state.disposed) {
            return;
        }
        if (LEVELS[recordLevel] < LEVELS[level]) {
            return;
        }
        const withStack = stackLevel !== "off" && LEVELS[recordLevel] >= LEVELS[stackLevel];
        // 调用点每级都要（info/warn 也带）；全栈只给 stackLevel 及以上。
        const frames = externalFrames();
        const built = buildRecord(recordLevel, args, {
            name: options.name,
            site: callSiteOf(frames),
            fn: functionOf(frames),
            stack: withStack ? stackOf(frames) : undefined,
            time: now(),
        });
        // child 的固定字段在前、本次调用的字段在后：更具体的赢。
        const record = Object.keys(fixedFields).length > 0 ? { ...fixedFields, ...built } : built;
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
                name: name ?? options.name,
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
            clearTimer();
            flush();
            for (const sink of sinks) {
                const close = sink.close;
                if (typeof close !== "function") {
                    continue;
                }
                try {
                    close.call(sink);
                }
                catch (error) {
                    reportSinkError(error);
                }
            }
        },
    };
}
