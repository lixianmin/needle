const UNITS = ["B", "K", "M", "G", "T", "P"] as const;

/**
 * 数字转人话，行为与 got/convert.ToHuman 一致：
 *
 *   0        → "0B"
 *   1023     → "1023B"
 *   1024     → "1.00K"
 *   1048576  → "1.00M"
 *
 * 两位小数不是随便定的：调试时要能看出 1.02K 和 1.00K 的差别，再多一位就是噪音。
 *
 * 注意它默认按字节处理（小于 1024 会带 B）。展示层只在绝对值 ≥ 1024 时才调它，
 * 这样计数类数据（如 200 条日志）不会被写成 "200B"。
 */
export function toHuman(num: number): string {
  if (!Number.isFinite(num)) {
    return String(num);
  }

  const sign = num < 0 ? "-" : "";
  let value = Math.abs(num);

  if (value < 1024) {
    return `${sign}${Math.round(value)}${UNITS[0]}`;
  }

  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${sign}${value.toFixed(2)}${UNITS[unit]}`;
}

/**
 * 表格单元格的显示规则：整数且 ≥1024 走 toHuman，其余原样。
 *
 * 为什么不用 toHuman 处理所有数字：比率（如 0.0234 的事件循环利用率）会被
 * 四舍五入成 "0B"，那比不格式化更糟。
 */
export function displayNumber(value: number): string {
  if (!Number.isInteger(value) || Math.abs(value) < 1024) {
    return String(value);
  }

  return toHuman(value);
}

/**
 * 毫秒转时长。跟 toHuman 分开，因为"57 秒"和"57K 字节"是两种东西，
 * 用同一把尺子量就会得到 uptime = 57.72K 这种没意义的读数。
 *
 *   123     → "123ms"
 *   12_300  → "12.3s"
 *   312_000 → "5m 12s"
 *   7_980_000 → "2h 13m"
 *   277_200_000 → "3d 5h"
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return String(ms);
  }

  const sign = ms < 0 ? "-" : "";
  const value = Math.abs(ms);

  if (value < 1000) {
    return `${sign}${Math.round(value)}ms`;
  }

  if (value < 60_000) {
    return `${sign}${(value / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(value / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${sign}${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${sign}${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  return `${sign}${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
