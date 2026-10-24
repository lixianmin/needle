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
  return [...new Glob("**/*.{ts,js,mjs}").scanSync({ cwd })]
    // dist 是 src 的产物，扫两遍没意义；且打包结果里的 hono 本来就来自 src。
    .filter((rel) => !rel.includes("/dist/"))
    // 示例 app 自带 node_modules（不装则无法构建），第三方包里的 hono 不是本仓库的代码。
    .filter((rel) => !rel.includes("/node_modules/"))
    .map((rel) => join(dir, rel));
}

/**
 * 口径（2026-10-24 收窄）：`got` / `logo` / `shell` 三个包不依赖任何 Web 框架，
 * 客户用 Hono 时由客户的应用代码挂 handler。`@needle/honox` 是唯一显式例外——
 * 它就是"框架底座"，`hono` 在它的 peerDependencies 里；示例 app 需要它。
 */
const LEGACY_PACKAGES = ["got", "logo", "shell"];

/** 允许出现 `hono` 的目录前缀：新包自己，和演示用法的示例 app。 */
const ALLOWED_PREFIXES = ["packages/honox/", "examples/honox-app/"];

function pkg(rel: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(source(rel)) as ReturnType<typeof JSON.parse>;
}

describe("needle 的旧三包不依赖 Hono", () => {
  test("根 package.json 与 got/logo/shell 的依赖表里都没有 hono", () => {
    const rels = ["package.json", ...LEGACY_PACKAGES.map((name) => `packages/${name}/package.json`)];
    for (const rel of rels) {
      const manifest = pkg(rel);
      expect(Object.keys(manifest.dependencies ?? {})).not.toContain("hono");
      expect(Object.keys(manifest.devDependencies ?? {})).not.toContain("hono");
      expect(Object.keys(manifest.peerDependencies ?? {})).not.toContain("hono");
    }
  });

  test("依赖图：got 空、logo 空、shell → logo", () => {
    const deps = (rel: string): Record<string, string> => pkg(rel).dependencies ?? {};
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
      const manifest = JSON.parse(source(rel)) as { exports: Record<string, unknown> };
      expect(Object.keys(manifest.exports)).toEqual(expected);
    }
  });
});

describe("honox 是唯一允许依赖 Hono 的包", () => {
  test("hono 只出现在 honox 的 peerDependencies 里", () => {
    const manifest = pkg("packages/honox/package.json");
    expect(manifest.peerDependencies?.hono).toBeDefined();
    expect(manifest.dependencies ?? {}).not.toHaveProperty("hono");
  });

  test("hono 的 import 只出现在 honox 与示例 app 里", () => {
    const offenders = [...codeFiles("packages"), ...codeFiles("examples")]
      .filter((rel) => /from\s+["']hono(\/|["'])/.test(source(rel)))
      .filter((rel) => !ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix)));
    expect(offenders).toEqual([]);
  });
});

/**
 * 示例 app 只演示 `@needle/honox`，不引入 npm 上的 honox（HonoX）。
 * 两者同名但无关；带上 HonoX 会额外拖进 precinct → @typescript-eslint/typescript-estree，
 * 把示例钉死在旧 TypeScript 上，也让「honox」这个词在依赖表里出现两次。
 */
describe("示例 app 不依赖 npm 的 honox（HonoX）", () => {
  test("依赖表里没有 honox 及其构建链", () => {
    const manifest = pkg("examples/honox-app/package.json");
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(names).not.toContain("honox");
    expect(names).not.toContain("vite");
    expect(names).not.toContain("@hono/vite-build");
  });

  test("源码里没有从 honox 的 import", () => {
    const offenders = codeFiles("examples/honox-app").filter((rel) =>
      /from\s+["']honox(\/|["'])/.test(source(rel)),
    );
    expect(offenders).toEqual([]);
  });

  test("示例的 TypeScript 与根同版本", () => {
    const root = pkg("package.json").devDependencies?.typescript;
    const example = pkg("examples/honox-app/package.json").devDependencies?.typescript;
    expect(example).toBe(root);
    expect(root?.startsWith("7.0.")).toBe(true);
  });
});
