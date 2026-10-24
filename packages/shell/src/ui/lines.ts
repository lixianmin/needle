import { LEVEL_HINTS, displayNumber, formatDuration, formatTime, toHuman } from "@needle/logo";
import type { LogRecord } from "@needle/logo";
import { el } from "./dom.js";
import { ROW_HEIGHT } from "./loglist.js";

/** 主题行的人话格式：字节走 toHuman，毫秒转秒，比率原样。 */
export function formatMetric(key: string, value: unknown): string {
  if (typeof value !== "number") {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value) ?? "";
  }
  if (key === "rss" || key === "heapUsed") {
    return toHuman(value);
  }
  // 约定：以 Ms 结尾的字段是毫秒数（uptimeMs、latencyMs…），按时长渲染。
  if (key.endsWith("Ms")) {
    return formatDuration(value);
  }
  return displayNumber(value);
}

/** 估算行高：一行消息 + 栈的每一行。真实高度等渲染后由测量覆盖。 */
export function estimateLogHeight(record: LogRecord): number {
  if (typeof record.stack !== "string" || record.stack === "") {
    return ROW_HEIGHT;
  }
  return ROW_HEIGHT * (1 + record.stack.split("\n").length);
}

export function renderLogLine(doc: Document, record: LogRecord): HTMLElement {
  const line = el(doc, "div", "row");
  const head = el(doc, "div", "head");
  const time = el(doc, "span", "t");
  time.textContent = formatTime(record.time);
  const text = el(doc, "span", `lv lv-${record.level}`);
  text.textContent = `${LEVEL_HINTS[record.level] ?? "[?]"} ${record.msg ?? ""}`;
  head.append(time, text);
  line.append(head);

  // 栈直接铺在行里，不用点开：排查时少一步，读的时候也不用离开上下文。
  if (typeof record.stack === "string" && record.stack !== "") {
    const stack = el(doc, "pre", "stack");
    stack.textContent = record.stack;
    line.append(stack);
  }
  return line;
}

/** 一行主题推送：`[top] rss=36.3MB heap=1.6MB …`。 */
export function renderTopicLine(doc: Document, topic: { name: string; data: unknown }): HTMLElement {
  const line = el(doc, "div", "row");
  line.textContent = formatTopic(topic.name, topic.data);
  return line;
}

function formatTopic(name: string, data: unknown): string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return `[${name}] ${JSON.stringify(data)}`;
  }
  const pairs = Object.entries(data as Record<string, unknown>).map(
    ([key, value]) => `${key}=${formatMetric(key, value)}`,
  );
  return `[${name}] ${pairs.join("  ")}`;
}
