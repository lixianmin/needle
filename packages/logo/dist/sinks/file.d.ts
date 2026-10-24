import { type Level, type Sink } from "../types.js";
export interface FileSinkOptions {
    dir: string;
    /** 单个文件上限，默认 10MB。 */
    maxBytes?: number;
    /** 归档保留天数，默认 7 天。 */
    keepDays?: number;
    /**
     * 建文件的最低级别，默认 info——于是只有 info.log / warn.log / error.log。
     * 打开 debug 日志时传 "debug"，才会多一个 debug.log。
     */
    minLevel?: Level;
    now?: () => number;
}
export type FileSink = Sink & {
    close(): void;
};
/**
 * 按级别分文件，且高级别级联写入低级别文件：
 *
 *   info.log  ← info, warn, error
 *   warn.log  ← warn, error
 *   error.log ← error
 *
 * 这样查一个问题不用同时翻三个文件：想先扫全局就看 info.log，只想看告警就
 * 看 warn.log。文件按需创建——没开 debug 就不会冒出一个空的 debug.log。
 *
 * 写盘用 appendFileSync：整个批量设计就是"每 100ms 一次 IO"，一次阻塞写
 * 换来的是「warn/error 立即落盘」和「退出前 flush 就真的写下去了」。
 */
export declare function createFileSink(options: FileSinkOptions): FileSink;
//# sourceMappingURL=file.d.ts.map