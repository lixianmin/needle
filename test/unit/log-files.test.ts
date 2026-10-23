import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogFiles } from "../../src/logo/log-files.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logo-log-files-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createLogFiles sample", () => {
  test("list 返回的 entry 带末尾 5 行 sample", async () => {
    const dir = tempDir();
    const lines = Array.from({ length: 10 }, (_, index) => `line-${index}`);
    writeFileSync(join(dir, "info.log"), `${lines.join("\n")}\n`);

    const files = await createLogFiles({ dir }).list();
    expect(files).toHaveLength(1);
    expect(files[0]?.sample?.split("\n")).toEqual(lines.slice(5));
  });

  test("文件不足 5 行时 sample 为全部行", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "info.log"), "a\nb\n");

    const files = await createLogFiles({ dir }).list();
    expect(files[0]?.sample).toBe("a\nb");
  });

  test("空文件 sample 为空字符串", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "info.log"), "");

    const files = await createLogFiles({ dir }).list();
    expect(files[0]?.sample).toBe("");
  });

  test("超长行截断到 200 字符", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "info.log"), `${"x".repeat(300)}\n`);

    const files = await createLogFiles({ dir }).list();
    expect(files[0]?.sample?.length).toBe(200);
  });

  test("末行无换行符也计入 sample", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "info.log"), "a\nb\nc");

    const files = await createLogFiles({ dir }).list();
    expect(files[0]?.sample).toBe("a\nb\nc");
  });

  test("行长超过读取窗口时扩大窗口凑满 5 行", async () => {
    const dir = tempDir();
    // 每行 1000 字符：末尾 5 行共约 5KB，超过初始 4KB 窗口
    const lines = Array.from({ length: 10 }, (_, index) => `line-${index}-`.padEnd(1000, "y"));
    writeFileSync(join(dir, "info.log"), `${lines.join("\n")}\n`);

    const files = await createLogFiles({ dir }).list();
    // 每行会被 sample 的 200 字符截断规则剪短；本测试只钉「窗口扩大后凑满 5 行」
    expect(files[0]?.sample?.split("\n")).toEqual(lines.slice(5).map((line) => line.slice(0, 200)));
  });
});
