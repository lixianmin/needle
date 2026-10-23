import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogFiles } from "../../src/logo/log-files.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logo-logfiles-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createLogFiles", () => {
  test("只列、只读 .log 文件", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "info.log"), "hello");
    writeFileSync(join(dir, ".env"), "SECRET=1");

    const files = createLogFiles({ dir });
    expect((await files.list()).map((entry) => entry.name)).toEqual(["info.log"]);
    expect(await files.read(".env")).toBeNull();
    expect(await files.read("info.log")).toBe("hello");
  });

  test("符号链接读不出去", async () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, "secret.log"), "SHOULD NOT LEAK");
    symlinkSync(join(outside, "secret.log"), join(dir, "link.log"));

    const files = createLogFiles({ dir });
    expect((await files.list()).map((entry) => entry.name)).toEqual([]);
    expect(await files.read("link.log")).toBeNull();
  });

  test("超过 maxFileBytes 的文件按读不到处理", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "big.log"), "x".repeat(200));

    const files = createLogFiles({ dir, maxFileBytes: 100 });
    expect(await files.read("big.log")).toBeNull();
  });
});
