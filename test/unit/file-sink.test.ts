import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileSink } from "../../src/node/file-sink.js";
import type { Level, LogRecord } from "../../src/core/logo/types.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logo-file-sink-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
