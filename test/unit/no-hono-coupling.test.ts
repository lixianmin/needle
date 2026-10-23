import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 递归列出代码文件，供"整个仓库不许出现 hono"这类扫描用。 */
function codeFiles(dir: string): string[] {
  const cwd = join(ROOT, dir);
  return [...new Glob("**/*.{ts,js,mjs}").scanSync({ cwd })].map((rel) => join(dir, rel));
}

describe("needle 自己不依赖 Hono", () => {
  // 要求：客户用 Hono 时由客户的应用代码挂 handler（两行），needle 不提供
  // 框架适配层，也不把任何框架放进依赖表——装了 Hono 的人跟没装的人拿到
  // 的是同一个包。
  const packages = ["packages/logo", "packages/shell"];

  test("两个包的 dependencies 与 devDependencies 里都没有 hono", () => {
    for (const dir of packages) {
      const pkg = JSON.parse(source(`${dir}/package.json`)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain("hono");
      expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("hono");
    }
  });

  test("两个包都不导出框架适配入口", () => {
    const logo = JSON.parse(source("packages/logo/package.json")) as { exports: Record<string, unknown> };
    const shell = JSON.parse(source("packages/shell/package.json")) as { exports: Record<string, unknown> };
    expect(Object.keys(logo.exports)).toEqual([".", "./node"]);
    expect(Object.keys(shell.exports)).toEqual([".", "./node"]);
  });

  test("packages 与 examples 里不出现 from \"hono\"", () => {
    const offenders = [...codeFiles("packages"), ...codeFiles("examples")].filter((rel) =>
      /from\s+["']hono(\/|["'])/.test(source(rel)),
    );
    expect(offenders).toEqual([]);
  });
});
