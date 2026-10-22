import { formatLine } from "./line.js";
import { hasStdout } from "./runtime.js";
import type { Sink } from "./types.js";

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
export const stdoutSink: Sink = (batch) => {
  if (batch.length === 0) return;

  if (hasStdout()) {
    const text = batch.map(formatLine).join("\n");
    process.stdout.write(`${text}\n`);
    return;
  }

  for (const record of batch) {
    console.log(formatLine(record));
  }
};
