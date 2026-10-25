import { execFileSync } from "node:child_process";

/**
 * 只对「相对主分支改动过的源文件」跑变异测试。
 *
 * 全仓 `break` 只能守住「总分不许掉」，守不住「新代码里全是没测的分支」——
 * 一块新代码就算 30% 存活，只要总分还在门槛之上就没人知道。这条闸门补的就是
 * 这个洞：改动过的文件必须当场把突变体杀干净。
 *
 * 不进合并门禁：它依赖「与主分支的差异」，在合并流程里（rebase 到最新主分支
 * 之后）差异为空，跑了个寂寞。用法是推之前、或者在功能分支上手动跑。
 */

/** 参与变异测试的包与它们各自的配置：两个包的 break 是分开 ratchet 的。 */
export const PACKAGES = [
  { dir: "packages/honox", config: "stryker.conf.json" },
  { dir: "packages/logo", config: "stryker.logo.conf.json" },
] as const;

/**
 * 从 `git diff --name-only` 的输出里挑出该包要变异的文件。
 *
 * `types.ts` 是纯类型声明，没有可执行逻辑（Stryker 自己也变不出东西来），
 * 默认排除——全量配置里也是这样排除的。
 */
export function pickSources(paths: readonly string[], dir: string): string[] {
  const prefix = `${dir}/src/`;

  return paths.filter(
    (path) => path.startsWith(prefix) && path.endsWith(".ts") && !path.endsWith("/types.ts"),
  );
}

function changedPaths(base: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" });

  return out.split("\n").filter((line) => line !== "");
}

function main(): void {
  const base = process.argv[2] ?? "origin/main";
  const changed = changedPaths(base);
  let failed = false;

  for (const pkg of PACKAGES) {
    const files = pickSources(changed, pkg.dir);
    if (files.length === 0) {
      continue;
    }

    console.log(`[mutate:diff] ${pkg.dir}：${files.length} 个文件 → ${pkg.config}`);
    try {
      execFileSync("bunx", ["stryker", "run", "--inPlace", pkg.config, "--mutate", files.join(",")], {
        stdio: "inherit",
      });
    } catch {
      failed = true;
    }
  }

  // 没有改动就是一次空跑：不是失败，但要说清楚，免得以为「测过了」。
  if (!failed && PACKAGES.every((pkg) => pickSources(changed, pkg.dir).length === 0)) {
    console.log(`[mutate:diff] 相对 ${base} 没有改动过的源文件，跳过`);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main();
}
