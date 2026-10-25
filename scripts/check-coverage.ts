import { readFileSync, readdirSync, statSync } from "node:fs";

/**
 * 校验每个包的 `src` 行覆盖率 ≥ 90%（AGENTS.md §11.1）。
 *
 * 输入是 `bun test --coverage-reporter=lcov` 产出的 `coverage/lcov.info`。
 * 为什么按包分别算：bunfig 的 `coverageThreshold` 只认全局数字，而全局 91%
 * 底下藏着一个 85% 的包（2026-10-25 shell 就是 87.45%）正是这条规则要挡的。
 * 分母只算 `packages/<包>/src/`：`dist/` 是构建产物，`test/` 是脚手架，
 * `*.generated.ts` 是生成物——它们都不该决定「测试写得够不够」。
 */
const THRESHOLD = 0.9; // 与 AGENTS.md §11.1 的 90% 同步；改规则时两处一起改
const LCOV = "coverage/lcov.info";

interface Totals {
  linesFound: number;
  linesHit: number;
}

/** 每个声明了 src 的包都必须出现在报告里，没被测到 = 0%，不能静默跳过。 */
function packageNames(): string[] {
  return readdirSync("packages")
    .filter((name) => statSync(`packages/${name}/src`, { throwIfNoEntry: false })?.isDirectory() === true)
    .sort();
}

/** 每个包出现在报告里就一定能从文件路径认出来：`packages/<包>/src/...`。 */
function readTotals(): Map<string, Totals> {
  const totals = new Map<string, Totals>();
  const text = readFileSync(LCOV, "utf8");

  for (const record of text.split("end_of_record")) {
    const file = /^SF:(.+)$/m.exec(record)?.[1];
    if (file === undefined) {
      continue;
    }
    const name = /(?:^|\/)packages\/([^/]+)\/src\//.exec(file)?.[1];
    if (name === undefined) {
      continue;
    }
    const count = (key: string): number => {
      const raw = new RegExp(`^${key}:(\\d+)$`, "m").exec(record)?.[1];
      return raw === undefined ? 0 : Number(raw);
    };
    const current = totals.get(name) ?? { linesFound: 0, linesHit: 0 };
    current.linesFound += count("LF");
    current.linesHit += count("LH");
    totals.set(name, current);
  }
  return totals;
}

const totals = readTotals();
const failures: string[] = [];

for (const name of packageNames()) {
  const found = totals.get(name)?.linesFound ?? 0;
  const hit = totals.get(name)?.linesHit ?? 0;
  const pct = found === 0 ? 0 : hit / found;
  const ok = pct >= THRESHOLD;
  if (!ok) {
    failures.push(name);
  }
  const mark = ok ? "ok  " : "FAIL";
  console.log(`${mark} packages/${name}  行覆盖 ${(pct * 100).toFixed(2)}%  (${hit}/${found})`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 个包低于 ${THRESHOLD * 100}%：补测试，不要降阈值（AGENTS.md §11.1）`);
  process.exit(1);
}

console.log(`\n每个包的行覆盖都 ≥ ${THRESHOLD * 100}%`);
