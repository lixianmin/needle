import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("needle 不把 Hono 变成依赖", () => {
  // 要求：Demo 里没装 Hono 也要能跑，功能一模一样。
  // 判据：核心入口的**运行时代码**里不能出现对 hono 的 import。
  test.each([
    "src/core/index.ts",
    "src/console/index.ts",
    "src/node/index.ts",
    "src/core/logo/index.ts",
  ])("%s 不 import hono", (file) => {
    expect(source(file)).not.toMatch(/from\s+["']hono["']/);
    expect(source(file)).not.toMatch(/from\s+["']hono\//);
  });

  test("package.json 的 dependencies 里没有 hono", () => {
    const pkg = JSON.parse(source("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("hono");
  });

  test("hono 适配层只引入类型（不产生运行时代码依赖）", () => {
    const adapter = source("src/hono/index.ts");
    // 只允许 `import type`
    const valueImports = adapter
      .split("\n")
      .filter((line) => /^import\s/.test(line) && !/^import\s+type\s/.test(line));
    for (const line of valueImports) {
      expect(line).not.toContain("hono");
    }
  });
});
