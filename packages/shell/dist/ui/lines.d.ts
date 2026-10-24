import type { LogRecord } from "@needle/logo";
/** 主题行的人话格式：字节走 toHuman，毫秒转秒，比率原样。 */
export declare function formatMetric(key: string, value: unknown): string;
/** 估算行高：一行消息 + 栈的每一行。真实高度等渲染后由测量覆盖。 */
export declare function estimateLogHeight(record: LogRecord): number;
export declare function renderLogLine(doc: Document, record: LogRecord): HTMLElement;
/** 一行主题推送：`[top] rss=36.3MB heap=1.6MB …`。 */
export declare function renderTopicLine(doc: Document, topic: {
    name: string;
    data: unknown;
}): HTMLElement;
//# sourceMappingURL=lines.d.ts.map