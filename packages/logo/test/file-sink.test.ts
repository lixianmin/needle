import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatLine } from "../src/line.js";
import { createFileSink } from "../src/sinks/file.js";
import type { Level, LogRecord } from "../src/types.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logo-file-sink-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const record = (level: Level, msg: string): LogRecord => ({ time: 1, level, msg });
const read = (dir: string, name: string): string[] =>
  readFileSync(join(dir, name), "utf8").trim().split("\n");

describe("createFileSink", () => {
  test("按级别分文件，且高级别级联写入", () => {
    const dir = tempDir();
    createFileSink({ dir })([record("info", "i"), record("warn", "w"), record("error", "e")]);

    // 每行是"时间 [I] {json}"，取 json 段解析
    const messages = (name: string) =>
      read(dir, name).map((line) => JSON.parse(line.slice(line.indexOf("] ") + 2)).msg);

    // info.log 收全部，warn.log 收 warn+error，error.log 只收 error
    expect(messages("info.log")).toEqual(["i", "w", "e"]);
    expect(messages("warn.log")).toEqual(["w", "e"]);
    expect(messages("error.log")).toEqual(["e"]);
  });

  test("没写过的级别不产生空文件", () => {
    const dir = tempDir();
    createFileSink({ dir })([record("error", "e")]);

    const names = readdirSync(dir).sort();
    expect(names).toEqual(["error.log", "info.log", "warn.log"]);
    expect(names).not.toContain("debug.log");
  });

  test("单文件超过 maxBytes 后归档并重开", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 60 });

    sink([record("error", "x".repeat(40))]);
    sink([record("error", "y".repeat(40))]);

    const names = readdirSync(dir);
    expect(names.filter((name) => name.startsWith("error-")).length).toBe(1);
    // 归档只针对 error.log，别的级别不受影响
    expect(read(dir, "error.log").length).toBe(1);
  });

  test("过期归档会被清理", () => {
    const dir = tempDir();
    const day = 24 * 60 * 60 * 1000;
    const { writeFileSync, utimesSync } = require("node:fs") as typeof import("node:fs");
    const old = join(dir, "info-2020-01-01T00-00-00-000Z.log");
    writeFileSync(old, "{}\n");
    utimesSync(old, new Date(0), new Date(0));

    const sink = createFileSink({ dir, maxBytes: 60, now: () => 300 * day });
    sink([record("info", "x".repeat(40))]);
    sink([record("info", "y".repeat(40))]);

    expect(readdirSync(dir)).not.toContain("info-2020-01-01T00-00-00-000Z.log");
  });

  test("close 之后不再写入", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir });
    sink([record("info", "a")]);
    sink.close();
    sink([record("info", "b")]);

    expect(read(dir, "info.log").length).toBe(1);
  });
});

describe("重启与清理", () => {
  test("已有文件时按磁盘大小继续算 maxBytes", () => {
    const dir = tempDir();
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(dir, "error.log"), "x".repeat(50));

    const sink = createFileSink({ dir, maxBytes: 60 });
    sink([record("error", "y".repeat(40))]);

    // 50 + 40 > 60：先归档再写，error.log 里只剩新的一条
    expect(read(dir, "error.log").length).toBe(1);
    expect(readdirSync(dir).filter((name) => name.startsWith("error-")).length).toBe(1);
  });

  test("没有轮转也会清理过期归档", () => {
    const dir = tempDir();
    const day = 24 * 60 * 60 * 1000;
    const { writeFileSync, utimesSync } = require("node:fs") as typeof import("node:fs");
    const old = join(dir, "warn-2020-01-01T00-00-00-000Z.log");
    writeFileSync(old, "{}\n");
    utimesSync(old, new Date(0), new Date(0));

    createFileSink({ dir, now: () => 300 * day })([record("info", "tiny")]);
    expect(readdirSync(dir)).not.toContain("warn-2020-01-01T00-00-00-000Z.log");
  });

  test("同一毫秒的第二次轮转不会覆盖前一个归档", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 60, now: () => 1_700_000_000_000 });

    sink([record("error", "x".repeat(40))]);
    sink([record("error", "y".repeat(40))]);
    sink([record("error", "z".repeat(40))]);

    expect(readdirSync(dir).filter((name) => name.startsWith("error-")).length).toBe(2);
  });
});

describe("默认值与目录创建", () => {
  test("默认 maxBytes 是 10MB：几千字节的两批不会触发轮转", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir });

    sink([record("info", "x".repeat(1000))]);
    sink([record("info", "y".repeat(1000))]);

    // 阈值被改小（比如把 `* 1024 * 1024` 改坏）时，第二批就会挤出一个归档
    expect(readdirSync(dir).filter((name) => name.startsWith("info-"))).toEqual([]);
    expect(read(dir, "info.log").length).toBe(2);
  });

  test("多级目录一次建出来（recursive）", () => {
    const dir = join(tempDir(), "a", "b", "c");
    const sink = createFileSink({ dir });
    sink([record("info", "nested")]);

    expect(read(dir, "info.log").length).toBe(1);
  });

  test("目录已存在时不重复创建也不报错", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir });
    sink([record("info", "a")]);
    expect(() => sink([record("info", "b")])).not.toThrow();
    expect(read(dir, "info.log").length).toBe(2);
  });

  test('minLevel: "debug" 时才有 debug.log，且级联收全', () => {
    const dir = tempDir();
    createFileSink({ dir, minLevel: "debug" })([
      record("debug", "d"),
      record("info", "i"),
      record("error", "e"),
    ]);

    expect(read(dir, "debug.log").length).toBe(3);
    expect(read(dir, "info.log").length).toBe(2);
  });
});

describe("归档与清理的边界", () => {
  const day = 24 * 60 * 60 * 1000;

  /** 造一个占位归档，mtime 指到指定时刻。 */
  function seedArchive(dir: string, name: string, mtimeMs: number): string {
    const { writeFileSync, utimesSync } = require("node:fs") as typeof import("node:fs");
    const path = join(dir, name);
    writeFileSync(path, "{}\n");
    utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
    return path;
  }

  test("过期按 keepDays 算：8 天前的删掉，6 天前的留着", () => {
    const dir = tempDir();
    const now = 1_700_000_000_000;
    seedArchive(dir, "info-8d.log", now - 8 * day);
    seedArchive(dir, "info-6d.log", now - 6 * day);

    createFileSink({ dir, now: () => now })([record("info", "x")]);

    const names = readdirSync(dir);
    expect(names).not.toContain("info-8d.log");
    expect(names).toContain("info-6d.log");
  });

  test("正好落在 cutoff 上的归档不算过期（区间是严格小于）", () => {
    const dir = tempDir();
    const now = 1_700_000_000_000;
    const cutoff = now - 7 * day;   // 默认 keepDays: 7
    seedArchive(dir, "info-exact.log", cutoff);

    createFileSink({ dir, now: () => now })([record("info", "x")]);

    expect(readdirSync(dir)).toContain("info-exact.log");
  });

  test("只清「.log 且带时间戳」的归档：正在写的文件与别的文件都不动", () => {
    const dir = tempDir();
    const now = 1_700_000_000_000;
    const ancient = now - 400 * day;
    seedArchive(dir, "info.log", ancient);        // 正在写的，没有连字符
    seedArchive(dir, "notes-1.txt", ancient);     // 有连字符但不是 .log
    seedArchive(dir, "readme.md", ancient);       // 都不是

    createFileSink({ dir, now: () => now })([record("info", "x")]);

    const names = readdirSync(dir);
    expect(names).toContain("notes-1.txt");
    expect(names).toContain("readme.md");
    // info.log 被这次写入追加过：光看「文件还在」不够（删掉也会被重建），要看旧内容还在
    expect(readFileSync(join(dir, "info.log"), "utf8")).toContain("{}");
  });

  test("归档名是 <level>-<ISO 时间>.log，冒号与点换成连字符", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 60, now: () => 1_700_000_000_000 });
    sink([record("error", "x".repeat(40))]);
    sink([record("error", "y".repeat(40))]);

    expect(readdirSync(dir)).toContain("error-2023-11-14T22-13-20-000Z.log");
  });

  test("同一毫秒的第三次轮转也拿到不重名的归档（-2）", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 60, now: () => 1_700_000_000_000 });

    sink([record("error", "x".repeat(40))]);
    sink([record("error", "y".repeat(40))]);
    sink([record("error", "z".repeat(40))]);
    sink([record("error", "w".repeat(40))]);

    const archives = readdirSync(dir).filter((name) => name.startsWith("error-")).sort();
    expect(archives).toEqual([
      "error-2023-11-14T22-13-20-000Z-1.log",
      "error-2023-11-14T22-13-20-000Z-2.log",
      "error-2023-11-14T22-13-20-000Z.log",
    ]);
  });

  test("轮转会清空该级别的记账，下一批不会立刻再轮转", () => {
    const dir = tempDir();
    // 上限取「两批之和减 1」：第二批必然触发轮转，轮转后单批 + 一小条又回到限内
    const sizeOf = (msg: string): number =>
      Buffer.byteLength(formatLine({ time: 1, level: "error", msg }) + "\n", "utf8");
    const sink = createFileSink({ dir, maxBytes: sizeOf("x".repeat(40)) * 2 - 1 });

    sink([record("error", "x".repeat(40))]);
    sink([record("error", "y".repeat(40))]);   // 触发轮转
    sink([record("error", "z")]);              // 记账已清零，不该再轮转

    expect(readdirSync(dir).filter((name) => name.startsWith("error-")).length).toBe(1);
  });

  test("轮转时顺带清理过期归档（不是只在首批清理一次）", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 60, now: () => 1_700_000_000_000 });
    sink([record("error", "x".repeat(40))]);   // 首批：这一趟已经把 pruned 置位

    const old = seedArchive(dir, "error-2020-01-01T00-00-00-000Z.log", 0);
    sink([record("error", "y".repeat(40))]);   // 触发轮转 → 里面的 prune 必须删掉它

    expect(readdirSync(dir)).not.toContain("error-2020-01-01T00-00-00-000Z.log");
    expect(old).toContain("error-");
  });

  test("文件被外部删掉后再轮转不会抛，且记账回到 0（不会凭空多轮转一次）", () => {
    const dir = tempDir();
    const { rmSync: remove } = require("node:fs") as typeof import("node:fs");
    const sizeOf = (msg: string): number =>
      Buffer.byteLength(formatLine({ time: 1, level: "error", msg }) + "\n", "utf8");
    const big = "x".repeat(40);
    const sink = createFileSink({ dir, maxBytes: sizeOf(big) * 2 - 1 });

    sink([record("error", big)]);
    remove(join(dir, "error.log"));

    expect(() => sink([record("error", big)])).not.toThrow();
    expect(read(dir, "error.log").length).toBe(1);

    // 记账若没归零，下一小条就会顶过上限、凭空挤出一个归档
    sink([record("error", "z")]);
    expect(readdirSync(dir).filter((name) => name.startsWith("error-"))).toEqual([]);
  });

  test("外部追加不算进记账：轮转仍按 sink 自己写过的字节数判断", () => {
    const dir = tempDir();
    const { appendFileSync } = require("node:fs") as typeof import("node:fs");
    const sink = createFileSink({ dir, maxBytes: 100 });

    sink([record("error", "x".repeat(10))]);
    appendFileSync(join(dir, "error.log"), "y".repeat(500), "utf8");
    sink([record("error", "z".repeat(10))]);

    // 记账里只有 10 + 10，远小于 100：不该因为磁盘上的外部追加而轮转
    expect(readdirSync(dir).filter((name) => name.startsWith("error-"))).toEqual([]);
  });
});

describe("轮转时机", () => {
  test("单个空文件的第一批即使超上限也不轮转（没有东西可归档）", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 10 });
    sink([record("info", "x".repeat(100))]);

    expect(readdirSync(dir).filter((name) => name.startsWith("info-"))).toEqual([]);
    expect(read(dir, "info.log").length).toBe(1);
  });

  test("正好等于上限时不轮转，超过才轮转", () => {
    const dir = tempDir();
    const sizeOf = (msg: string): number =>
      Buffer.byteLength(formatLine({ time: 1, level: "info", msg }) + "\n", "utf8");
    const first = "x".repeat(10);
    const second = "y".repeat(20);
    // 两批之和正好等于上限：不许轮转
    const sink = createFileSink({ dir, maxBytes: sizeOf(first) + sizeOf(second) });

    sink([record("info", first)]);
    sink([record("info", second)]);
    expect(readdirSync(dir).filter((name) => name.startsWith("info-"))).toEqual([]);
    expect(read(dir, "info.log").length).toBe(2);

    // 再加一条，必然超过上限
    sink([record("info", "z")]);
    expect(readdirSync(dir).filter((name) => name.startsWith("info-")).length).toBe(1);
  });

  test("记账用累计值：两批各 60 字节在 100 上限下必须轮转", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 100 });

    sink([record("info", "x".repeat(60))]);
    sink([record("info", "y".repeat(60))]);

    expect(readdirSync(dir).filter((name) => name.startsWith("info-")).length).toBe(1);
  });
});
