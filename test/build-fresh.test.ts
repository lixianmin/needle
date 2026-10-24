import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// git checkout / clone 会把一批文件写成几乎相同的 mtime，给 2 秒容差防误报。
const TOLERANCE_MS = 2_000;

function newestMtime(dir: string, skip?: (name: string) => boolean): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full, skip));
      continue;
    }
    if (skip?.(entry.name) === true) {
      continue;
    }
    newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

const pairs: Array<[string, string, string]> = [
  ["packages/core/src", "packages/core/dist/index.js", "bun run build:core"],
  ["packages/logo/src", "packages/logo/dist/index.js", "bun run build:logo"],
  ["packages/shell/src", "packages/shell/dist/index.js", "bun run build:shell"],
];

describe("提交的 dist 不比源码旧", () => {
  for (const [sourceDir, distFile, command] of pairs) {
    test(`${distFile} 是最新的`, () => {
      const built = statSync(join(ROOT, distFile)).mtimeMs;
      const source = newestMtime(join(ROOT, sourceDir));
      expect(source - built).toBeLessThanOrEqual(TOLERANCE_MS);
      if (source - built > TOLERANCE_MS) {
        console.error(`产物过期，先跑 ${command}`);
      }
    });
  }

  test("内联 UI 脚本不比 ui 源码旧", () => {
    const generated = join(ROOT, "packages/shell/src/ui/script.generated.ts");
    const built = statSync(generated).mtimeMs;
    const source = newestMtime(join(ROOT, "packages/shell/src/ui"), (name) =>
      name === "script.generated.ts",
    );
    expect(source - built).toBeLessThanOrEqual(TOLERANCE_MS);
    if (source - built > TOLERANCE_MS) {
      console.error("UI 脚本过期，先跑 bun run build:ui");
    }
  });
});
