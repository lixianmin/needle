import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { formatLine } from "../core/logo/line.js";
import { LEVELS, type Level, type LogRecord, type Sink } from "../core/logo/types.js";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_KEEP_DAYS = 7;

/** 可能建文件的级别，从最啰嗦到最严重。 */
const LEVELS_BY_FILE: readonly Level[] = ["debug", "info", "warn", "error"];

export interface FileSinkOptions {
  dir: string;
  /** 单个文件上限，默认 10MB。 */
  maxBytes?: number;
  /** 归档保留天数，默认 7 天。 */
  keepDays?: number;
  /**
   * 建文件的最低级别，默认 info——于是只有 info.log / warn.log / error.log。
   * 打开 debug 日志时传 "debug"，才会多一个 debug.log。
   */
  minLevel?: Level;
  now?: () => number;
}

export type FileSink = Sink & { close(): void };

/**
 * 按级别分文件，且高级别级联写入低级别文件：
 *
 *   info.log  ← info, warn, error
 *   warn.log  ← warn, error
 *   error.log ← error
 *
 * 这样查一个问题不用同时翻三个文件：想先扫全局就看 info.log，只想看告警就
 * 看 warn.log。文件按需创建——没开 debug 就不会冒出一个空的 debug.log。
 *
 * 写盘用 appendFileSync：整个批量设计就是"每 100ms 一次 IO"，一次阻塞写
 * 换来的是「warn/error 立即落盘」和「退出前 flush 就真的写下去了」。
 */
export function createFileSink(options: FileSinkOptions): FileSink {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS;
  const now = options.now ?? Date.now;
  const minLevel = options.minLevel ?? "info";
  // 级联的落点是 [minLevel, 记录级别]，所以 error 会进 info/warn/error，
  // 但不会凭空造一个 debug.log。
  const fileLevels = LEVELS_BY_FILE.filter((level) => LEVELS[level] >= LEVELS[minLevel]);

  const bytes = new Map<string, number>();
  let closed = false;

  function ensureDir(): void {
    if (!existsSync(options.dir)) mkdirSync(options.dir, { recursive: true });
  }

  function prune(): void {
    const cutoff = now() - keepDays * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(options.dir)) {
      // 只清归档（带时间戳的），当前正在写的四个文件不动。
      if (!name.endsWith(".log") || !name.includes("-")) continue;
      const path = join(options.dir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch {
        // 被别的进程删了/锁了：下一次滚动再处理。
      }
    }
  }

  function rotate(file: string, level: Level): void {
    if (!existsSync(file)) {
      bytes.set(level, 0);
      return;
    }
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    renameSync(file, join(options.dir, `${level}-${stamp}.log`));
    bytes.set(level, 0);
    prune();
  }

  function write(level: Level, lines: string[]): void {
    if (lines.length === 0) return;

    const file = join(options.dir, `${level}.log`);
    const text = `${lines.join("\n")}\n`;
    const size = Buffer.byteLength(text, "utf8");

    const current = bytes.get(level) ?? 0;
    if (current > 0 && current + size > maxBytes) rotate(file, level);

    appendFileSync(file, text, "utf8");
    bytes.set(level, (bytes.get(level) ?? 0) + size);
  }

  const sink = ((batch: readonly LogRecord[]) => {
    if (closed || batch.length === 0) return;

    ensureDir();

    // 先按目标文件分组：一条 warn 会同时进 info.log 与 warn.log，
    // 但只做两次批量写，而不是逐条写。
    const buckets = new Map<Level, string[]>();
    for (const record of batch) {
      for (const target of fileLevels) {
        if (LEVELS[record.level] < LEVELS[target]) continue;
        const lines = buckets.get(target) ?? [];
        lines.push(formatLine(record));
        buckets.set(target, lines);
      }
    }

    for (const [level, lines] of buckets) write(level, lines);
  }) as FileSink;

  sink.close = () => {
    closed = true;
  };

  return sink;
}
