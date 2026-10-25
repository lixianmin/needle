import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { workspacePackageDirs } from "./workspaces.js";

/**
 * 把根 package.json 的 version 写进每个 workspace 包。
 *
 * `package.json` 不支持字段引用，所以单一来源只能靠机械同步：根的 version 是
 * 唯一真值，这里只负责搬过去；pre-commit 每次提交前跑，test/version-lock.test.ts
 * 在忘记同步时把门禁弄红。
 */
const root = JSON.parse(readFileSync("package.json", "utf8"));
if (typeof root.version !== "string" || root.version === "") {
  console.error("根 package.json 缺少 version，拒绝同步");
  process.exit(1);
}

const targets = workspacePackageDirs().map((dir) => join(dir, "package.json"));

let changed = 0;
for (const full of targets) {
  const pkg = JSON.parse(readFileSync(full, "utf8"));
  if (pkg.version === root.version) {
    continue;
  }

  pkg.version = root.version;
  writeFileSync(full, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${relative(process.cwd(), full)}: ${root.version}`);
  changed += 1;
}

console.log(changed === 0 ? "version:sync 无需改动" : `version:sync 更新 ${changed} 个包`);
