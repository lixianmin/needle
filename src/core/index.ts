import { createLogger } from "./logger.js";
import { stdoutSink } from "./sink.js";

export { createLogger } from "./logger.js";
export { createRingSink } from "./ring.js";
export { stdoutSink } from "./sink.js";
export { hasStdout } from "./runtime.js";
export { buildRecord, safeStringify } from "./record.js";
export { SortedTable, defaultComparer } from "./sorted-table.js";
export type { Comparer } from "./sorted-table.js";
export { displayNumber, formatDuration, toHuman } from "./human.js";
export { UTC_OFFSET_MINUTES, formatTime } from "./time.js";
export { LEVEL_HINTS, formatLine, parseLine } from "./line.js";
export { LEVELS } from "./types.js";

export type { Logger, LoggerOptions } from "./logger.js";
export type { RingSink } from "./ring.js";
export type { Level, LogRecord, Sink } from "./types.js";

/**
 * 默认实例，开箱即用：info 级别、写 stdout。
 *
 * 库不提供 `setDefaultLogger` 这类全局替换入口——需要另一个实例就直接
 * `createLogger()`，依赖从参数传，避免隐藏的单例状态。
 */
export const logo = createLogger({ sinks: [stdoutSink] });
