import { buildRecord } from "./record.js";
import { hasStdout } from "./sinks/stdout.js";
import { LEVELS } from "./types.js";
/** 默认 100ms 刷一次。服务端够用；客户端要按帧刷可设成 16~33。 */
const DEFAULT_FLUSH_INTERVAL_MS = 100;
/** 缓冲上限。达到就立刻 flush —— 用它兜住内存，而不是丢日志。 */
const DEFAULT_MAX_BUFFER = 10_000;
/** 栈帧里属于本库内部的行，采集时要剪掉，否则看到的全是自己的帧。 */
const INTERNAL_FRAME = /\/core\/(logo|record)\.(ts|js):/;
/**
 * 捕获调用点。
 *
 * 第一行是 "Error" 头，后面是本库内部的帧，都要剪掉——留着只会让真正的
 * 调用点被埋在第 6 行。代价是每次 warn/error 构造一个 Error，因此只在
 * stackLevel 命中的级别上做。
 */
function captureStack() {
    const raw = new Error().stack ?? "";
    return raw
        .split("\n")
        .filter((line, index) => index === 0 || !INTERNAL_FRAME.test(line))
        .join("\n");
}
export function newLogger(options = {}) {
    const now = options.now ?? Date.now;
    const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const stackLevel = options.stackLevel ?? "warn";
    const batch = options.batch ?? hasStdout();
    let level = options.level ?? "info";
    let buffer = [];
    let timer;
    let sinkReported = false;
    const sinks = [...(options.sinks ?? [])];
    const fixedFields = { ...options.fields };
    function reportSinkError(error) {
        // 只提示一次：一条坏 sink 可能每 100ms 抛一次，刷屏比沉默更糟。
        if (sinkReported)
            return;
        sinkReported = true;
        console.error("[logo] sink 抛错，后续错误不再提示:", error);
    }
    function clearTimer() {
        if (timer === undefined)
            return;
        clearTimeout(timer);
        timer = undefined;
    }
    function flush() {
        clearTimer();
        if (buffer.length === 0)
            return;
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
        if (!batch || flushIntervalMs <= 0 || timer !== undefined)
            return;
        timer = setTimeout(() => {
            timer = undefined;
            flush();
        }, flushIntervalMs);
        // 不阻止进程退出：一批还没到期的日志不值得让服务挂着不关。
        const handle = timer;
        handle.unref?.();
    }
    function emit(recordLevel, args) {
        if (LEVELS[recordLevel] < LEVELS[level])
            return;
        const withStack = stackLevel !== "off" && LEVELS[recordLevel] >= LEVELS[stackLevel];
        const built = buildRecord(recordLevel, args, {
            name: options.name,
            stack: withStack ? captureStack() : undefined,
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
        schedule();
    }
    return {
        debug: (...args) => emit("debug", args),
        info: (...args) => emit("info", args),
        warn: (...args) => emit("warn", args),
        error: (...args) => emit("error", args),
        child(fields) {
            const { name, ...rest } = fields;
            return newLogger({
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
            });
        },
        addSink(sink) {
            sinks.push(sink);
        },
        removeSink(sink) {
            const index = sinks.indexOf(sink);
            if (index >= 0)
                sinks.splice(index, 1);
        },
        setLevel(next) {
            level = next;
        },
        flush,
        dispose() {
            clearTimer();
            flush();
            for (const sink of sinks) {
                const close = sink.close;
                if (typeof close !== "function")
                    continue;
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
