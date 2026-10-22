/**
 * 东八区偏移（分钟）。
 *
 * 存储一律是 epoch 毫秒（不带时区），展示固定按 +08:00 格式化——不跟机器时区走。
 * 理由：日志要能跨机器对比。开发机在 UTC、服务器在 Asia/Shanghai 时，如果各按
 * 本地时区渲染，同一条日志在两边显示的时间不一样，排障时先要算时差。
 */
export const UTC_OFFSET_MINUTES = 8 * 60;

const OFFSET_MS = UTC_OFFSET_MINUTES * 60 * 1000;

/** `2026-10-22T15:04:05`，精确到秒，UTC+8。 */
export function formatTime(time: number): string {
  const date = new Date(time + OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}
