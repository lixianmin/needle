import type { LogRecord } from "./types.js";
/**
 * 东八区偏移（分钟）。
 *
 * 存储一律是 epoch 毫秒（不带时区），展示固定按 +08:00 格式化——不跟机器时区走。
 * 理由：日志要能跨机器对比。开发机在 UTC、服务器在 Asia/Shanghai 时，如果各按
 * 本地时区渲染，同一条日志在两边显示的时间不一样，排障时先要算时差。
 */
export declare const UTC_OFFSET_MINUTES: number;
/** `2026-10-22T15:04:05`，精确到秒，UTC+8。 */
export declare function formatTime(time: number): string;
/** 级别缩写，与 Go 版 logo 的 [D]/[I]/[W]/[E] 对齐。 */
export declare const LEVEL_HINTS: Record<string, string>;
/**
 * 一行日志去掉时间戳之后的部分（照 rim.server 的 Go 版 logo）：
 *
 *   [I] request-log.ts:28 [requestLog()] {"rid":"01JB..."}
 *
 * 前缀给人看，后面那段给机器解析。`time` / `level` / `site` / `fn` 只出现在前缀里，
 * 不再重复进 JSON——同一条信息写两遍，既是浪费，也给了两个可能不一致的来源。
 *
 * 控制台面板按行渲染时用它（时间单独一个 span），落盘用 `formatLine`。
 */
export declare function formatPayload(record: LogRecord): string;
/**
 * 一行日志的落盘格式（照 rim.server 的 Go 版 logo：日期T时间 [级别] 文件:行 [函数()] 载荷）：
 *
 *   2026-10-22T15:04:05 [I] request-log.ts:28 [requestLog()] {"rid":"01JB...","msg":"-->"}
 */
export declare function formatLine(record: LogRecord): string;
/** 从一行日志里把 JSON 载荷解析回来。前缀不参与解析。 */
export declare function parseLine(line: string): Record<string, unknown> | null;
//# sourceMappingURL=line.d.ts.map