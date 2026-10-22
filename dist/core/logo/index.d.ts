export { newLogger } from "./logo.js";
export type { Logger, LoggerOptions } from "./logo.js";
export { stdoutSink, hasStdout } from "./sinks/stdout.js";
export { buildRecord, safeStringify } from "./record.js";
export type { BuildOptions } from "./record.js";
export { LEVEL_HINTS, formatLine, parseLine } from "./line.js";
export { UTC_OFFSET_MINUTES, formatTime } from "./line.js";
export { displayNumber, formatDuration, toHuman } from "./human.js";
export { LEVELS } from "./types.js";
export type { Level, LogRecord, Sink } from "./types.js";
/**
 * 默认实例，开箱即用：info 级别、写 stdout。
 *
 * 不提供 setLogger 之类的全局替换入口——要换个实例直接用 newLogger()，
 * 依赖从参数传，避免隐藏的单例状态。文件、飞书等 sink 用 addSink 挂上去。
 */
export declare const logo: import("./logo.js").Logger;
