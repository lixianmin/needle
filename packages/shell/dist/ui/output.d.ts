import type { ExecResult } from "./adapter.js";
import type { TableRenderer } from "./table.js";
/** 输出区的写入口：命令结果、状态提示都往这里塞。 */
export interface OutputSink {
    push(node: HTMLElement): void;
    pushText(text: string, className?: string): void;
}
export declare function createOutputSink(doc: Document, output: HTMLElement): OutputSink;
/** 把一次命令执行的结果渲染到输出区。 */
export declare function renderOutput(result: ExecResult, sink: OutputSink, table: TableRenderer): void;
//# sourceMappingURL=output.d.ts.map