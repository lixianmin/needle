import { safeStringify } from "@needle/logo";
import type { CommandOutput } from "../types.js";
import type { ExecResult } from "./adapter.js";
import { el } from "./dom.js";
import type { TableRenderer } from "./table.js";

/** 输出区保留的最大行数。再多浏览器会开始卡，而且人也不会往回翻那么远。 */
const MAX_LINES = 500;

/** 输出区的写入口：命令结果、状态提示都往这里塞。 */
export interface OutputSink {
  push(node: HTMLElement): void;
  pushText(text: string, className?: string): void;
}

export function createOutputSink(doc: Document, output: HTMLElement): OutputSink {
  function push(node: HTMLElement): void {
    output.append(node);
    while (output.childElementCount > MAX_LINES) {
      output.firstElementChild?.remove();
    }
    output.scrollTop = output.scrollHeight;
  }

  function pushText(text: string, className?: string): void {
    const line = el(doc, "div", className);
    line.textContent = text;
    push(line);
  }

  return { push, pushText };
}

/** 把一次命令执行的结果渲染到输出区。 */
export function renderOutput(result: ExecResult, sink: OutputSink, table: TableRenderer): void {
  if (!result.ok) {
    sink.pushText(result.unauthorized === true ? "未登录：先执行 auth <user>" : result.error, "status");
    return;
  }

  const value: CommandOutput = result.output;
  if (value.kind === "text") {
    for (const line of value.text.split("\n")) {
      // 空行要占一行高：空的 div 高度是 0，help 里分组之间那条空行会被吃掉。
      sink.pushText(line === "" ? "\u00A0" : line);
    }
    return;
  }
  if (value.kind === "table") {
    sink.push(table(value.columns, value.rows, value.formats));
    return;
  }
  // 命令返回的 JSON 可能有循环引用或 BigInt：JSON.stringify 会抛，页面就停在
  // 上一条输出。先试格式化，失败再退回 safeStringify（它会标 [Circular]）。
  let text: string;
  try {
    text = JSON.stringify(value.value, null, 2) ?? String(value.value);
  } catch {
    text = safeStringify(value.value);
  }
  sink.pushText(text, "raw");
}
