import { type Level, type Sink } from "./types.js";
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
    child(fields: Record<string, unknown> & {
        name?: string;
    }): Logger;
    addSink(sink: Sink): void;
    removeSink(sink: Sink): void;
    setLevel(level: Level): void;
    flush(): void;
    dispose(): void;
}
export declare function newLogger(options?: LoggerOptions): Logger;
