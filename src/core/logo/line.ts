import { safeStringify } from "./record.js";
import { formatTime } from "./time.js";
import type { LogRecord } from "./types.js";

/** 级别缩写，与 Go 版 logo 的 [D]/[I]/[W]/[E] 对齐。 */
export const LEVEL_HINTS: Record<string, string> = {
  debug: "[D]",
  info: "[I]",
  warn: "[W]",
  error: "[E]",
};

/**
 * 一行日志的落盘格式：
 *
 *   2026-10-22T15:04:05 [I] {"msg":"burst","seq":1}
 *
 * 前缀给人看（时间 + 级别，秒级、东八区），后面那段给机器解析。
 * `time` 与 `level` 只出现在前缀里，不再重复进 JSON——同一条信息写两遍，
 * 既是浪费，也给了两个可能不一致的来源。
 */
export function formatLine(record: LogRecord): string {
  const { time, level, ...rest } = record;
  const hint = LEVEL_HINTS[level] ?? "[?]";
  return `${formatTime(time)} ${hint} ${safeStringify(rest)}`;
}

/** 从一行日志里把 JSON 载荷解析回来。前缀不参与解析。 */
export function parseLine(line: string): Record<string, unknown> | null {
  const index = line.indexOf("] ");
  if (index < 0) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice(index + 2));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
