/**
 * 能不能同步写 stdout。
 *
 * 这个探测被两处使用，必须共用同一个实现：
 *   1. stdout sink 选择写入方式（write 还是 console.log）
 *   2. logger 决定要不要做定时批量（Workers 上逐条写，见下）
 *
 * 不能用在 Workers 上做批量刷新的理由：响应返回后未触发的定时器可能被
 * 取消，批量反而会把日志弄丢；而且那边的输出本来就是平台级缓冲。
 */
export function hasStdout(): boolean {
  return typeof process !== "undefined" && typeof process.stdout?.write === "function";
}
