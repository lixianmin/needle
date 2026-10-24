import type { Sink } from "../types.js";
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
export declare function hasStdout(): boolean;
/**
 * 把一批记录写出去。
 *
 * 能同步写 stdout 时，整批拼成一个字符串、只调一次 write —— 这正是批量
 * 设计想要的效果。不能的话（Workers）逐条 console.log，因为那边的输出
 * 本来就有平台级缓冲，再合并只是减少自身调用次数，收益可忽略。
 *
 * 能力探测放在调用时而不是模块初始化时：两次 typeof 检查可以忽略不计，
 * 换来的是这个函数不依赖"进程长什么样"这个模块级快照。
 */
export declare const stdoutSink: Sink;
//# sourceMappingURL=stdout.d.ts.map