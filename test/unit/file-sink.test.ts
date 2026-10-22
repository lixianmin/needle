import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileSink } from "../../src/node/file-sink.js";
import type { LogRecord } from "../../src/core/types.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logo-file-sink-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const record = (msg: string): LogRecord => ({ time: 1, level: "info", msg });

describe("createFileSink", () => {
  test("一个 batch 写多行合法 JSON", () => {
    const dir = tempDir();
    createFileSink({ dir })([record("a"), record("b")]);

    const lines = readFileSync(join(dir, "app.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line).msg)).toEqual(["a", "b"]);
  });

  test("超过 maxBytes 后归档并重开", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir, maxBytes: 60 });

    sink([record("x".repeat(40))]);
    sink([record("y".repeat(40))]);

    const files = readdirSync(dir).sort();
    expect(files.length).toBe(2);
    expect(files.some((name) => name.startsWith("app-"))).toBe(true);
  });

  test("过期归档会被清理", () => {
    const dir = tempDir();
    const day = 24 * 60 * 60 * 1000;
    let clock = 10 * day;
    const old = join(dir, "app-old.log");
    writeFileSync(old, "{}\n");
    // 把修改时间改到 20 天前：用 utimes 而不是依赖文件系统时间。
    const { utimesSync } = require("node:fs") as typeof import("node:fs");
    utimesSync(old, new Date(0), new Date(0));

    const sink = createFileSink({ dir, maxBytes: 60, now: () => clock });
    sink([record("x".repeat(40))]);
    sink([record("y".repeat(40))]);

    expect(readdirSync(dir).includes("app-old.log")).toBe(false);
    clock += day;
  });

  test("close 之后不再写入", () => {
    const dir = tempDir();
    const sink = createFileSink({ dir });
    sink([record("a")]);
    sink.close();
    sink([record("b")]);

    const lines = readFileSync(join(dir, "app.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });
});
