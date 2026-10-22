import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { safeStringify } from "../core/record.js";
import type { Sink } from "../core/types.js";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_KEEP_DAYS = 7;

export interface FileSinkOptions {
  dir: string;
  /** 单文件上限，默认 10MB。 */
  maxBytes?: number;
  /** 归档保留天数，默认 7 天。 */
  keepDays?: number;
  now?: () => number;
}

export type FileSink = Sink & { close(): void };

/**
 * 滚动文件 sink。
 *
 * 用 appendFileSync 而不是 fs/promises：整个批量设计就是"每 100ms 一次 IO"，
 * 一次阻塞写换来的是「warn/error 立即落盘」和「退出前 flush 就真的写下去了」。
 * 异步写在进程崩溃时会把最后几条留在内存里，那正是最需要的那几条。
 */
export function createFileSink(options: FileSinkOptions): FileSink {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS;
  const now = options.now ?? Date.now;

  const file = join(options.dir, "app.log");
  let bytes = 0;
  let closed = false;

  function ensureDir(): void {
    if (!existsSync(options.dir)) mkdirSync(options.dir, { recursive: true });
  }

  function prune(): void {
    const cutoff = now() - keepDays * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(options.dir)) {
      if (!name.endsWith(".log") || name === "app.log") continue;
      const path = join(options.dir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch {
        // 文件被别的进程删了/锁了：下一次滚动再处理。
      }
    }
  }

  function rotate(): void {
    if (!existsSync(file)) {
      bytes = 0;
      return;
    }
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    renameSync(file, join(options.dir, `app-${stamp}.log`));
    bytes = 0;
    prune();
  }

  const sink = ((batch) => {
    if (closed || batch.length === 0) return;

    const text = `${batch.map(safeStringify).join("\n")}\n`;
    const size = Buffer.byteLength(text, "utf8");

    ensureDir();
    if (bytes > 0 && bytes + size > maxBytes) rotate();

    appendFileSync(file, text, "utf8");
    bytes += size;
  }) as FileSink;

  sink.close = () => {
    closed = true;
  };

  return sink;
}
