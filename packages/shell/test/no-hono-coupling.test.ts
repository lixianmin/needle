import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** packages/shell/test/ → 仓库根。 */
const ROOT = join(import.meta.dir, "..", "..", "..");

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
  test("所有 package.json 的 dependencies 与 devDependencies 里都没有 hono", () => {
    for (const rel of ["package.json", "packages/got/package.json", "packages/logo/package.json", "packages/shell/package.json"]) {
      const pkg = JSON.parse(source(rel)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain("hono");
      expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("hono");
    }
  });

  test("依赖图只有一条生产边：shell → logo", () => {
    const deps = (rel: string): Record<string, string> => {
      const pkg = JSON.parse(source(rel)) as { dependencies?: Record<string, string> };
      return pkg.dependencies ?? {};
    };
    expect(deps("packages/got/package.json")).toEqual({});
    expect(deps("packages/logo/package.json")).toEqual({});
    expect(deps("packages/shell/package.json")).toEqual({ "@needle/logo": "workspace:*" });
  });

  test("入口表里没有框架适配入口", () => {
    const entries: Record<string, string[]> = {
      "packages/got/package.json": ["."],
      "packages/logo/package.json": [".", "./node"],
      "packages/shell/package.json": [".", "./node"],
    };
    for (const [rel, expected] of Object.entries(entries)) {
      const pkg = JSON.parse(source(rel)) as { exports: Record<string, unknown> };
      expect(Object.keys(pkg.exports)).toEqual(expected);
    }
  });

  test("packages 与 examples 里不出现 from \"hono\"", () => {
    const offenders = [...codeFiles("packages"), ...codeFiles("examples")].filter((rel) =>
      /from\s+["']hono(\/|["'])/.test(source(rel)),
    );
    expect(offenders).toEqual([]);
  });
});
