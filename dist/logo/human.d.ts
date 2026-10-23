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
export declare function toHuman(num: number): string;
/**
 * 表格单元格的显示规则：整数且 ≥1024 走 toHuman，其余原样。
 *
 * 为什么不用 toHuman 处理所有数字：比率（如 0.0234 的事件循环利用率）会被
 * 四舍五入成 "0B"，那比不格式化更糟。
 */
export declare function displayNumber(value: number): string;
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
export declare function formatDuration(ms: number): string;
