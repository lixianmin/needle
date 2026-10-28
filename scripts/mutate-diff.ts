import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 只对「相对主分支改动过的源文件」跑变异测试。
 *
 * 全仓 `bun run mutate` 要 8 分钟，合并门禁里跑它太贵；而全仓 break 又守不住
 * 「新代码里全是没测的分支」——一块新代码哪怕 30% 存活，只要总分还在门槛之上
 * 就没人知道。这个脚本补的是「改完立刻知道自己有没有留下存活突变体」，通常
 * 十几秒到一分钟。
 *
 * 它**不做门禁判定**：阈值是给全仓定的，套到「只改了某个本来就欠账的文件」
 * 这种子集上会误判（比如只动了 log-files.ts，那 43% 不是这次造成的）。
 * 权威判定仍然是合并前的 `bun run mutate` 全量跑。
 */

/** 参与变异测试的包与各自的配置：两个包的 break 是分开 ratchet 的。 */
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

interface Mutant {
  status: string;
  mutatorName: string;
  location: { start: { line: number } };
  replacement: string;
}

interface Report {
  files: Record<string, { mutants: Mutant[] }>;
}

const REPORT_PATH = "reports/mutation/mutation.json";

/** 临时配置：阈值关掉，报告落 JSON，其余照抄该包的正式配置。 */
function diffConfig(configPath: string): string {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.thresholds = { high: 100, low: 0, break: null };
  config.reporters = ["json"];
  // 正式配置里给 html reporter 的选项，换了 reporter 就没人认它了
  delete config.html;

  const out = join(".stryker-tmp", `diff-${configPath}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(config, null, 2));
  return out;
}

function summarize(files: readonly string[]): number {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
  let survived = 0;

  for (const [file, info] of Object.entries(report.files)) {
    const bad = info.mutants.filter((m) => m.status === "Survived" || m.status === "NoCoverage");
    if (bad.length === 0) {
      continue;
    }

    survived += bad.length;
    console.log(`  ${file}：${bad.length} 个没杀掉的突变体`);
    for (const m of bad.slice(0, 20)) {
      console.log(`    L${m.location.start.line} ${m.mutatorName} → ${m.replacement.slice(0, 60)}`);
    }

    if (bad.length > 20) {
      console.log(`    …还有 ${bad.length - 20} 个，明细见 ${REPORT_PATH}`);
    }
  }

  console.log(`[mutate:diff] 共 ${files.length} 个文件、${survived} 个没杀掉`);
  return survived;
}

function main(): void {
  const base = process.argv[2] ?? "origin/main";
  const changed = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");

  const targets = PACKAGES.map((pkg) => ({ ...pkg, files: pickSources(changed, pkg.dir) }))
    .filter((pkg) => pkg.files.length > 0);

  if (targets.length === 0) {
    console.log(`[mutate:diff] 相对 ${base} 没有改动过的源文件，跳过`);
    return;
  }

  for (const target of targets) {
    console.log(`[mutate:diff] ${target.dir}：${target.files.length} 个文件`);
    execFileSync(
      "bunx",
      ["stryker", "run", "--inPlace", diffConfig(target.config), "--mutate", target.files.join(",")],
      { stdio: "inherit" },
    );
    summarize(target.files);
  }
}

if (import.meta.main) {
  main();
}
