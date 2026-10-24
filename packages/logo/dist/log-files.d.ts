import type { LogFiles } from "./types.js";
export interface LogFilesOptions {
    /** 日志目录，相对路径按进程 cwd 解析。 */
    dir: string;
    /** 单个文件读入内存的上限，超过按"读不到"处理。默认 8MB。 */
    maxFileBytes?: number;
}
/**
 * 把日志目录暴露给 Shell 。
 *
 * 只做两件事：列目录、按名字读文件。安全性全在 `read` 上——名字必须是目录里
 * 直接存在的条目，不允许路径分隔符，解析后的绝对路径还必须落在目录内。
 * Shell 那边只拿得到这个名字，拿不到任意路径。
 */
export declare function createLogFiles(options: LogFilesOptions): LogFiles;
//# sourceMappingURL=log-files.d.ts.map