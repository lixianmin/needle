const HISTORY_KEY = "logo.shell.history";
const HISTORY_LIMIT = 50;

export function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    // 隐私模式、扩展沙箱里 localStorage 可能直接抛错。历史记录丢了不算故障。
    return [];
  }
}

export function writeHistory(lines: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(lines.slice(-HISTORY_LIMIT)));
  } catch {
    /* 同上，忽略 */
  }
}
