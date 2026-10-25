import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 根 package.json 的 workspaces 是 glob（`packages/*`），脚本和测试都不能再手抄
 * 一份包清单：新增一个包时，手抄的清单既不参与同步、也不参与兜底断言，版本号
 * 就悄悄分叉，而 `version:sync` 还会打印「无需改动」。
 */
export function workspacePackageDirs(root: string = process.cwd()): string[] {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const patterns: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
  const dirs: string[] = [];

  for (const pattern of patterns) {
    // 只支持本仓库用到的两种形态：目录名与 `目录/*`。更复杂的 glob 交给 bun，
    // 这里一旦猜错就会漏包，所以遇到不认识的形态直接报错而不是跳过。
    if (pattern.endsWith("/*")) {
      const base = join(root, pattern.slice(0, -2));
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          dirs.push(join(base, entry.name));
        }
      }
      continue;
    }

    if (pattern.includes("*")) {
      throw new Error(`workspaces 里的 glob 暂不支持：${pattern}`);
    }

    dirs.push(join(root, pattern));
  }

  return dirs.sort();
}
