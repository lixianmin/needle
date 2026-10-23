import { constants } from "node:fs";
import { lstat, open, readdir, type FileHandle } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { LogFileEntry, LogFiles } from "./types.js";

export interface LogFilesOptions {
  /** 日志目录，相对路径按进程 cwd 解析。 */
  dir: string;
  /** 单个文件读入内存的上限，超过按"读不到"处理。默认 8MB。 */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;

/** tips 预览的行数，GONSOLE 同款取 5。 */
const SAMPLE_LINES = 5;

/** 预览里单行截断到 200 字符：日志行可能是大段 JSON，不截会把 tooltip 撞爆。 */
const SAMPLE_LINE_MAX_CHARS = 200;

/** 尾读窗口：5 行典型日志行的宽松余量；不够时向下翻倍（见 readTailSample）。 */
const TAIL_WINDOW_BYTES = 4 * 1024;

/** 窗口上限：单行超大（几 MB 的 JSON）时放弃凑满 5 行，sample 是展示不是全文。 */
const TAIL_WINDOW_MAX_BYTES = 1024 * 1024;

function clipSampleLine(line: string): string {
  return line.length > SAMPLE_LINE_MAX_CHARS ? line.slice(0, SAMPLE_LINE_MAX_CHARS) : line;
}

/**
 * 读文件末尾最多 SAMPLE_LINES 行完整行，拼成 hover 预览。
 *
 * 从 EOF 往前开窗口读：窗口起点可能切在行（甚至多字节字符）中间，所以
 * start > 0 时丢弃第一段；凑不满 5 行且还没到文件头就把窗口翻倍重读。
 * 读失败一律返回空串——预览丢得起，列表不能因为它挂掉。
 */
async function readTailSample(path: string, size: number): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    // O_NOFOLLOW：read() 同样的口径，符号链接不跟。
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let windowBytes = TAIL_WINDOW_BYTES;
    for (;;) {
      const start = Math.max(0, size - windowBytes);
      const buffer = Buffer.alloc(size - start);
      // 按实际读到的字节截断：read 允许部分读，剩下的零字节会变成 \0 混进预览。
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);

      let lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
      if (start > 0) {
        lines = lines.slice(1);
      }
      if (lines[lines.length - 1] === "") {
        lines.pop();
      }
      lines = lines.filter((line) => line !== "");

      if (lines.length >= SAMPLE_LINES || start === 0 || windowBytes >= TAIL_WINDOW_MAX_BYTES) {
        return lines.slice(-SAMPLE_LINES).map(clipSampleLine).join("\n");
      }
      windowBytes *= 2;
    }
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * 把日志目录暴露给 Shell 。
 *
 * 只做两件事：列目录、按名字读文件。安全性全在 `read` 上——名字必须是目录里
 * 直接存在的条目，不允许路径分隔符，解析后的绝对路径还必须落在目录内。
 * Shell 那边只拿得到这个名字，拿不到任意路径。
 */
export function createLogFiles(options: LogFilesOptions): LogFiles {
  const dir = resolve(options.dir);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  /** 只暴露日志文件：目录里误放的 .env、备份、符号链接都不该被 Shell 读到。 */
  function isLogFile(name: string): boolean {
    return name.endsWith(".log") && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
  }

  return {
    async list(): Promise<LogFileEntry[]> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        // 目录还不存在（日志还没写过）：空列表比报错友好。
        return [];
      }

      const entries: LogFileEntry[] = [];
      for (const name of names) {
        if (!isLogFile(name)) {
          continue;
        }
        const info = await lstat(join(dir, name)).catch(() => null);
        if (info === null || !info.isFile()) {
          continue; // 符号链接 isFile() 为 false
        }
        entries.push({
          name,
          size: info.size,
          modified: info.mtimeMs,
          sample: await readTailSample(join(dir, name), info.size),
        });
      }

      return entries.sort((left, right) => left.name.localeCompare(right.name));
    },

    async read(name: string): Promise<string | null> {
      // 分隔符、.. 一律拒绝：不给自己留拼接路径的机会。
      if (!isLogFile(name)) {
        return null;
      }

      const full = resolve(dir, name);
      if (full !== join(dir, name) || !full.startsWith(dir + sep)) {
        return null;
      }

      let handle;
      try {
        // O_NOFOLLOW + 句柄上 fstat：打开与检查是同一个对象，中间被换成符号链接
        // 会直接 ELOOP，写入增长也按打开那一刻之后的真实大小判断。
        handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile() || info.size > maxFileBytes) {
          return null;
        }
        return await handle.readFile("utf8");
      } catch {
        return null;
      } finally {
        await handle?.close().catch(() => {});
      }
    },
  };
}
