import { buildRecord, sanitize } from "./record.js";
import { hasStdout } from "./sinks/stdout.js";
import { LEVELS } from "./types.js";
/** 默认 100ms 刷一次。服务端够用；客户端要按帧刷可设成 16~33。 */
const DEFAULT_FLUSH_INTERVAL_MS = 100;
/** 缓冲上限。达到就立刻 flush —— 用它兜住内存，而不是丢日志。 */
const DEFAULT_MAX_BUFFER = 10_000;
/** V8 帧：`    at fn (/a/b/file.ts:12:34)` 或 `    at /a/b/file.ts:12:34`。 */
// Stryker disable next-line Regex: `\s+(` 收成一个空格是等价变体——前面的 `(.*?)` 是惰性的，会把多出来的空格吃掉；正则本身由 frames.test.ts 逐个格式钉住
const FRAME_PATTERN = /^\s+at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;
/**
 * 从一行栈帧里取出文件路径。
 *
 * 导出是为了能拿合成帧做测试：真栈的格式由运行时决定，凑不出「无函数名」「Windows
 * 反斜杠」这些边角，而它们恰恰是这里的分支。
 */
export function parseFrame(line) {
    const match = FRAME_PATTERN.exec(line);
    const file = match?.[2];
    if (file === undefined || file === "") {
        return undefined;
    }
    return { file };
}
/** 取目录部分。没有分隔符时返回空串（相对文件名没有「所在目录」）。 */
function dirOf(file) {
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
export function pruneInternalFrames(frames, originFile) {
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
function externalFrames() {
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
function stackOf(frames) {
    return ["Error", ...frames].join("\n");
}
export function newLogger(options = {}) {
    return buildLogger(options, { disposed: false, buffer: [], timer: undefined });
}
function buildLogger(options, state) {
    const now = options.now ?? Date.now;
    const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const stackLevel = options.stackLevel ?? "error";
    const batch = options.batch ?? hasStdout();
    let level = options.level ?? "info";
    let sinkReported = false;
    const sinks = [...(options.sinks ?? [])];
    // child 的固定字段会被展开进每条记录，所以必须和 buildRecord 走同一套 sanitize：
    // 否则 child({ cb: () => {} }) 会让该 child 的每一条记录都不可被 sink 序列化
    // （IDB 的 put 直接抛 DataCloneError，整批写不进去）。
    const fixedFields = (sanitize(options.fields ?? {}) ?? {});
    function reportSinkError(error) {
        // 只提示一次：一条坏 sink 可能每 100ms 抛一次，刷屏比沉默更糟。
        if (sinkReported) {
            return;
        }
        sinkReported = true;
        console.error("[logo] sink 抛错，后续错误不再提示:", error);
    }
    function clearTimer() {
        if (state.timer === undefined) {
            return;
        }
        clearTimeout(state.timer);
        state.timer = undefined;
    }
    function flush() {
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
            }
            catch (error) {
                reportSinkError(error);
            }
        }
    }
    function schedule() {
        if (!batch || flushIntervalMs <= 0 || state.timer !== undefined) {
            return;
        }
        state.timer = setTimeout(() => {
            state.timer = undefined;
            flush();
        }, flushIntervalMs);
        // 不阻止进程退出：一批还没到期的日志不值得让服务挂着不关。
        const handle = state.timer;
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
            // Stryker disable next-line CallExpression: 排着的定时器必然对应非空缓冲，紧接着的 flush() 会自己清掉它（等价变体）
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
