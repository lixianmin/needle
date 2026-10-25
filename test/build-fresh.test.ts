import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
// git checkout / clone 会把一批文件写成几乎相同的 mtime，给 2 秒容差防误报。
const TOLERANCE_MS = 2_000;

const PACKAGES = [
  ["packages/got", "bun run build:got"],
  ["packages/logo", "bun run build:logo"],
  ["packages/shell", "bun run build:shell"],
  ["packages/honox", "bun run build:honox"],
] as const;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }

    files.push(full);
  }

  return files;
}

function newestMtime(dir: string, skip?: (name: string) => boolean): number {
  let newest = 0;
  for (const file of walk(dir)) {
    if (skip?.(file) === true) {
      continue;
    }

    newest = Math.max(newest, statSync(file).mtimeMs);
  }

  return newest;
}

/** dist 里所有 `.d.ts.map` 声明的源文件（相对包根）。 */
function mappedSources(pkgRoot: string): Set<string> {
  const dist = join(pkgRoot, "dist");
  const sources = new Set<string>();
  for (const file of walk(dist)) {
    if (!file.endsWith(".d.ts.map")) {
      continue;
    }

    const map = JSON.parse(readFileSync(file, "utf8")) as { sources: string[] };
    for (const entry of map.sources) {
      sources.add(relative(pkgRoot, resolve(dirname(file), entry)));
    }
  }

  return sources;
}

/**
 * 提交的 dist 必须和源码对得上。
 *
 * 两层检查，各自抓不同的情况：
 * 1. mtime：改完源码忘了重建——本地最常见，成本 0。
 * 2. `.d.ts.map` 里的 sources 清单：源码新增 / 删除 / 改名后没有重建。这一条是
 *    内容级的，`git checkout <旧提交> -- packages/x/dist` 把旧产物写回工作树也抓得到
 *    （旧产物里没有新文件的映射），而只比 mtime 时它是绿的。
 *
 * 已知局限：源码只在原有行内改动（不增删文件）而 dist 又恰好比 src 新，两层都过。
 * 这种情况由 pre-commit 钩子（提交前重跑 build）兜底，不在这条测试的职责里。
 */
describe("提交的 dist 与源码一致", () => {
  for (const [pkgRoot, command] of PACKAGES) {
    test(`${pkgRoot}/dist 覆盖全部源码文件`, () => {
      const sources = mappedSources(join(ROOT, pkgRoot));
      const actual = walk(join(ROOT, pkgRoot, "src"))
        .map((file) => relative(join(ROOT, pkgRoot), file))
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".generated.ts"));

      const missing = actual.filter((file) => !sources.has(file));
      // script.generated.ts 是 build:ui 的产物（源码在 src/ui/*.js），不参与这条比对。
      const extra = [...sources].filter(
        (file) => !actual.includes(file) && file !== "src/ui/script.generated.ts",
      );

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    test(`${pkgRoot}/dist 不比源码旧`, () => {
      const built = statSync(join(ROOT, pkgRoot, "dist", "index.js")).mtimeMs;
      const source = newestMtime(join(ROOT, pkgRoot, "src"));
      // 失败时直接抛断言信息，别写成 console.error：断言之后的代码根本不会执行。
      expect({ stale: source - built > TOLERANCE_MS, command }).toEqual({ stale: false, command });
    });
  }

  test("内联 UI 脚本不比 ui 源码旧", () => {
    const generated = join(ROOT, "packages/shell/src/ui/script.generated.ts");
    const built = statSync(generated).mtimeMs;
    const source = newestMtime(join(ROOT, "packages/shell/src/ui"), (file) =>
      file.endsWith("script.generated.ts"),
    );

    expect({ stale: source - built > TOLERANCE_MS, command: "bun run build:ui" }).toEqual({
      stale: false,
      command: "bun run build:ui",
    });
  });
});
