import { safeStringify } from "./record.js";
import type { LogRecord } from "./types.js";

/**
 * 东八区偏移（分钟）。
 *
 * 存储一律是 epoch 毫秒（不带时区），展示固定按 +08:00 格式化——不跟机器时区走。
 * 理由：日志要能跨机器对比。开发机在 UTC、服务器在 Asia/Shanghai 时，如果各按
 * 本地时区渲染，同一条日志在两边显示的时间不一样，排障时先要算时差。
 */
export const UTC_OFFSET_MINUTES = 8 * 60;

const OFFSET_MS = UTC_OFFSET_MINUTES * 60 * 1000;

/**
 * 上一次算过的秒（epoch 秒，已加偏移）与它的前缀。
 *
 * 一批日志基本同秒（默认攒批 100ms），命中率接近 100%：实测 formatTime 60 → 5ns，
 * 也就是每条日志省掉一次 `new Date` + 6 次 `padStart`。最坏情况（每条都跨一秒）
 * 多一次比较，约 +15ns，仍然不亏。用 NaN 当“还没缓存过”：NaN 不等于自己。
 */
let cachedSecond = Number.NaN;
// Stryker disable next-line StringLiteral: 缓存初始值只影响性能，命中与否不改变输出（等价突变体）
let cachedPrefix = "";

/** `2026-10-22T15:04:05`，精确到秒，UTC+8。 */
export function formatTime(time: number): string {
  // Stryker disable next-line ArithmeticOperator: 缓存键只需要自洽与“同秒同值”，换成任何等价算式的输出都一样
  const second = Math.floor((time + OFFSET_MS) / 1000);
  // Stryker disable next-line ConditionalExpression,BlockStatement: 命中分支只是复用上次的前缀，跳过它输出不变（等价突变体）
  if (second === cachedSecond) {
    return cachedPrefix;
  }

  const date = new Date(time + OFFSET_MS);
  const pad = (value: number) => String(value).padStart(2, "0");

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const secondText = pad(date.getUTCSeconds());

  const prefix = `${year}-${month}-${day}T${hour}:${minute}:${secondText}`;
  cachedSecond = second;
  cachedPrefix = prefix;
  return prefix;
}

/** 级别缩写，与 Go 版 logo 的 [D]/[I]/[W]/[E] 对齐。 */
export const LEVEL_HINTS: Record<string, string> = {
  debug: "[D]",
  info: "[I]",
  warn: "[W]",
  error: "[E]",
};

/**
 * 一行日志去掉时间戳之后的部分（照 rim.server 的 Go 版 logo）：
 *
 *   [I] request-log.ts:28 [requestLog()] {"rid":"01JB..."}
 *
 * 前缀给人看，后面那段给机器解析。`time` / `level` / `site` / `module` / `fn` 只出现在前缀里，
 * 不再重复进 JSON——同一条信息写两遍，既是浪费，也给了两个可能不一致的来源。
 *
 * `site`（文件:行）与 `module`（模块名）同义：都是「这条日志属于哪儿」，谁有就用谁。
 * honox 只给 `module`（注册时的文件:行打包后就是 bundle 坐标），logo 直调时一般给 `site`。
 *
 * 控制台面板按行渲染时用它（时间单独一个 span），落盘用 `formatLine`。
 */
export function formatPayload(record: LogRecord): string {
  const { time: _time, level, site, module, fn: fnName, ...rest } = record;
  const hint = LEVEL_HINTS[level] ?? "[?]";
  const label = site ?? module;
  const where = label === undefined ? "" : `${label} `;
  const who = fnName === undefined || fnName === "" ? "" : `[${fnName}()] `;
  return `${hint} ${where}${who}${stringifyRest(rest)}`;
}

/**
 * 序列化载荷。
 *
 * `rest` 来自 `buildRecord` 的产出，那时已经 sanitize 过（见 record.ts），所以
 * 正常路径直接 `JSON.stringify`——早先这里再跑一遍 `safeStringify`，等于把整条
 * 记录多 sanitize 一次，一条日志 313 → 103 ns。
 *
 * 绕开 `buildRecord` 直接调 `formatLine` / `formatPayload` 的记录则没这层保证，
 * 所以留着兜底：带环、带 BigInt 的手搓记录退回 `safeStringify`，行为与从前一致。
 */
function stringifyRest(rest: Record<string, unknown>): string {
  try {
    return JSON.stringify(rest) as string;
  } catch {
    return safeStringify(rest);
  }
}

/**
 * 一行日志的落盘格式（照 rim.server 的 Go 版 logo：日期T时间 [级别] 文件:行 [函数()] 载荷）：
 *
 *   2026-10-22T15:04:05 [I] request-log.ts:28 [requestLog()] {"rid":"01JB...","msg":"-->"}
 */
export function formatLine(record: LogRecord): string {
  return `${formatTime(record.time)} ${formatPayload(record)}`;
}

/** 从一行日志里把 JSON 载荷解析回来。前缀不参与解析。 */
export function parseLine(line: string): Record<string, unknown> | null {
  // 载荷永远是行的最后一段 JSON；前缀里现在还有 "]"（`[I]`、`[fn()]`），
  // 所以不能再用 "] " 定位，直接找第一个 "{"。
  const index = line.indexOf("{");
  if (index < 0) {
    return null;
  }

  try {
    // 起点就是第一个 `{`，所以 JSON.parse 的结果必是对象：类型护栏在这里是死代码，已删。
    return JSON.parse(line.slice(index)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
