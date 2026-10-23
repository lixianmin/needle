# 三包拆分实施计划（core / logo / shell）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单包 `@needle/needle` 拆成 `@needle/core`、`@needle/logo`、`@needle/shell` 三个 bun workspace 包，删掉伞包，全部 import 与构建/测试路径同步改完，行为零变化。

**Architecture:** 包内测试相对引用本包源码；跨包一律用包名（解析到 `dist`）；shell 只依赖 logo，core 无依赖。构建顺序 `core → logo → ui → shell`，`build:ui` 之所以在 logo 之后，是因为 UI 源码 import `@needle/logo`。仓库用 `git mv` 保历史。所有代码改动在 worktree 内完成（AGENTS.md §13），worktree 路径 `<仓库名>-<branch>`。

**Tech Stack:** TypeScript 7（nodenext / verbatimModuleSyntax）、Bun 1.4 workspaces、bun:test、happy-dom、miniflare。

**Spec:** `docs/superpowers/specs/2026-10-24-three-packages-design.md`

## Global Constraints

- 三个包版本均为 `0.3.7`；根 `package.json` 为 `private: true` 且**不带 `version`**；产品版本看 `packages/shell/package.json`。
- 不保留伞包：`@needle/needle` 及其 `./shell`、`./node` 全部消失，不留别名。
- 生产依赖只有一条：`packages/shell` → `"@needle/logo": "workspace:*"`。根的三条 workspace 依赖仅放 `devDependencies`（供 demo 与根级测试解析）。
- `@needle/core` 只导出 `SortedTable` / `Comparer` / `defaultComparer`，只有 `.` 一个 entry。
- `@needle/logo` 的 `.` 必须包含 `createLarkSink` / `LarkSink` / `LarkSinkOptions`。
- 每个包 `"type": "module"`、`"sideEffects": false`、`"files": ["dist"]`、`license: "MIT"`；`exports` 的 `types` 与 `default` 都指 `./dist/...`。
- `dist/` 随源码提交；pre-commit 必须重建并 stage 三份 dist。
- 控制流一律带花括号且语句体独占多行（AGENTS.md 代码风格节）；注释与文档用中文。
- 验收命令：`bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs`。
- 不改运行时代码逻辑：除 import 说明符与文件位置外，不重写函数体。

## Review Focus

1. **lark 导出丢失**：`createLarkSink` 今天由伞包根入口单独转出，搬家时最容易被漏掉；用户 `import { createLarkSink } from "@needle/logo"` 必须照旧可用。→ `packages/logo/test/exports.test.ts` 断言三个 lark 符号，`packages/logo/test/entry.test.ts` 断言根入口含 `createLarkSink`。
2. **浏览器入口混入 `node:`**：`bun build --target=browser` 遇到 `node:` 不报错、静默换成空实现，产物照样生成。→ 每个包自己的 `browser-safety.test.ts` 对打包产物做内容断言。
3. **干净构建顺序错**：`rm -rf packages/*/dist` 后若 `build:ui` 跑在 `build:logo` 之前，UI 打包解析不到 `@needle/logo`。→ Task 2 的干净构建步骤 + Task 4 的 `rm -rf` 门禁。
4. **改了 logo 源码却跑旧 dist**：shell 的测试与 demo 都经 `@needle/logo` 读 dist。→ 根 `test/build-fresh.test.ts` 用 mtime 兜底，2 秒容差。
5. **版本号来源错位**：demo 与 smoke 必须读 `packages/shell/package.json`，不是根、不是 logo。→ Task 2 的 grep 校验 + Task 3 文档同步。

---

### Task 1: `@needle/core` 独立成包

**Files:**
- Create: `packages/core/package.json`、`packages/core/tsconfig.build.json`、`packages/core/src/index.ts`、`packages/core/test/exports.test.ts`
- Move: `src/core/collections/sorted-table.ts` → `packages/core/src/collections/sorted-table.ts`；`test/unit/sorted-table.test.ts` → `packages/core/test/sorted-table.test.ts`
- Modify: `src/index.ts`（删掉 sorted-table 那一行）、`tsconfig.json`（include 加 `packages/*/src`、`packages/*/test`）

**Interfaces:**
- Consumes: 无。
- Produces: 包名 `@needle/core`，导出 `SortedTable<K, V>`、`Comparer<K>`、`defaultComparer<K>`；`packages/core/dist/index.{js,d.ts}`。

- [ ] **Step 1: 移动源码与测试**

```bash
mkdir -p packages/core/src/collections packages/core/test
git mv src/core/collections/sorted-table.ts packages/core/src/collections/sorted-table.ts
git mv test/unit/sorted-table.test.ts packages/core/test/sorted-table.test.ts
```

- [ ] **Step 2: 改测试的 import 为包内相对路径**

`packages/core/test/sorted-table.test.ts` 第 3 行：
`from "../../src/core/collections/sorted-table.js"` → `from "../src/collections/sorted-table.js"`。断言一行不改。

- [ ] **Step 3: 写包清单**

`packages/core/package.json`：

```json
{
  "name": "@needle/core",
  "version": "0.3.7",
  "description": "Needle 的通用数据结构：SortedTable",
  "type": "module",
  "sideEffects": false,
  "license": "MIT",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ]
}
```

`packages/core/tsconfig.build.json`：

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": [
    "src"
  ]
}
```

`packages/core/src/index.ts`：

```ts
export * from "./collections/sorted-table.js";
```

- [ ] **Step 4: 写按包名解析的导出测试（先红）**

`packages/core/test/exports.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 包根：test/ 的上一级就是 packages/core。 */
const PKG = join(import.meta.dir, "..");

describe("@needle/core 的导出映射", () => {
  test("只有一个入口，且指向真实存在的 dist 文件", () => {
    const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, { types: string; default: string }>;
    };

    expect(pkg.name).toBe("@needle/core");
    expect(Object.keys(pkg.exports)).toEqual(["."]);

    for (const entry of Object.values(pkg.exports)) {
      expect(entry.default.startsWith("./dist/")).toBe(true);
      readFileSync(join(PKG, entry.default));
      readFileSync(join(PKG, entry.types));
    }
  });

  test("按包名能拿到 SortedTable", async () => {
    const core = await import("@needle/core");
    expect(typeof core.SortedTable).toBe("function");
    expect(typeof core.defaultComparer).toBe("function");
  });
});
```

- [ ] **Step 5: 跑测试确认是红的**

Run: `bun test packages/core`
Expected: FAIL，`Cannot find module '@needle/core'` 或读不到 `dist/index.js`。

- [ ] **Step 6: 从根入口摘掉 sorted-table，并让根 tsconfig 覆盖 packages**

`src/index.ts` 删掉这一行：`export * from "./core/collections/sorted-table.js";`

`tsconfig.json` 的 `include` 改成：

```json
[
  "packages/*/src",
  "packages/*/test",
  "test",
  "examples",
  "scripts"
]
```

- [ ] **Step 7: 构建 core 并跑测试**

```bash
bunx tsc -p packages/core/tsconfig.build.json && bun test packages/core
```

Expected: 编译成功，`sorted-table.test.ts` 与 `exports.test.ts` 全 PASS。

- [ ] **Step 8: 确认根仓仍然绿**

```bash
bun run build && bunx tsc --noEmit && bun test
```

Expected: 全 PASS（根 `dist` 里不再有 `collections/`，无引用者）。

- [ ] **Step 9: 提交**

```bash
git add packages/core src/index.ts tsconfig.json test/unit/sorted-table.test.ts
git commit -m "refactor(core): 抽出 @needle/core，只留 SortedTable"
```

---

### Task 2: 搬迁 logo / shell 并切换工作区（原子一次提交）

本任务是硬切换：中间状态无法单独构建，所以只有一个 commit。步骤内的验证命令都是局部的，全部通过后再提交。

**Files:**
- Move: `src/logo/*` → `packages/logo/src/*`（去掉 `logo/` 层）；`src/shell/*` → `packages/shell/src/*`（去掉 `shell/` 层）；`src/core/web/{body,responsex}.ts` → `packages/shell/src/web/`；`src/index.ts` → `packages/logo/src/index.ts`；`src/node.ts` → `packages/logo/src/node.ts`
- Move tests: 见 Step 7 的映射表
- Create: `packages/{logo,shell}/package.json`、`packages/{logo,shell}/tsconfig.build.json`、三份 `entry.test.ts`、两份 `browser-safety.test.ts`、根 `test/build-fresh.test.ts`
- Modify: 全部 shell 源码 import；`examples/demo.ts`；`test/smoke/node.mjs`；根 `package.json`；`tsconfig.json`；`scripts/build-ui.mjs`；`scripts/size-log-only.ts`；`.githooks/pre-commit`
- Delete: 根 `dist/`、`tsconfig.build.json`、`src/` 残余、`test/unit/`、`test/integration/`、`test/workers/`、`test/fixtures.ts`

**Interfaces:**
- Consumes: Task 1 的 `@needle/core`（无代码依赖，只有同一套 workspace 约定）。
- Produces: `@needle/logo`（`.` + `./node`）、`@needle/shell`（`.` + `./node`）；`packages/*/dist`；根脚本 `build:core` / `build:logo` / `build:ui` / `build:shell` / `build` / `demo` / `size` / `test` / `typecheck`。

- [ ] **Step 1: 用 git mv 搬目录**

```bash
git mv src/logo packages/logo/src
git mv src/index.ts packages/logo/src/index.ts
git mv src/node.ts packages/logo/src/node.ts
git mv src/shell packages/shell/src
mkdir -p packages/shell/src/web
git mv src/core/web/body.ts packages/shell/src/web/body.ts
git mv src/core/web/responsex.ts packages/shell/src/web/responsex.ts
rmdir src/core/web src/core src 2>/dev/null || true
git rm -r -q dist tsconfig.build.json
```

`git mv 目录 目标` 在目标不存在时直接完成重命名，不需要先建目标目录。执行后确认 `ls src` 报 No such file or directory。

- [ ] **Step 2: 改写 shell 源码的 import**

规则（只改说明符，不改代码）：

| 旧 | 新 |
|---|---|
| `../logo/index.js` | `@needle/logo` |
| `../../logo/index.js`（`ui/` 下） | `@needle/logo` |
| `../core/web/body.js` | `./web/body.js` |
| `../core/web/responsex.js` | `./web/responsex.js` |

验证：`grep -rn "logo/\|core/web" packages/shell/src | grep -v "@needle/logo"` 应无输出。

- [ ] **Step 3: 重写两个入口文件**

`packages/logo/src/node.ts` 全文：

```ts
/**
 * logo 的 Node 专属入口：凡是要 `node:` 模块的能力都从这里出。
 *
 * 根入口（`.`）不碰 `node:`，浏览器和 Workers 打包不会把它们带上；反过来，
 * 只要在浏览器里 import 了这个入口，bundler 就会把 `node:fs` 换成空实现——
 * 所以这里的东西只能在 Node 用。
 */

export { createLogFiles } from "./log-files.js";
export type { LogFilesOptions } from "./log-files.js";

export { createFileSink } from "./sinks/file.js";
export type { FileSink, FileSinkOptions } from "./sinks/file.js";
```

`packages/logo/src/index.ts` 保留原 `src/index.ts` 的日志部分，删掉 `SortedTable` 那一行，并确保 lark 三件套在末尾：

```ts
export * from "./logo.js";
export * from "./line.js";
export * from "./record.js";
export * from "./human.js";
export * from "./types.js";
export * from "./sinks/stdout.js";
export * from "./sinks/idb.js";

export { createLarkSink } from "./sinks/lark.js";
export type { LarkSink, LarkSinkOptions } from "./sinks/lark.js";
```

以原文件实际导出清单为准合并（原 `src/logo/index.ts` + 原 `src/index.ts` 的 lark 两行），不要丢 `UTC_OFFSET_MINUTES`、`LEVEL_HINTS`、`parseLine`、`logger` 等具名导出。

`packages/shell/src/node.ts` 内容不变（本来就是 `serve` / `attach`）。

- [ ] **Step 4: 写 logo / shell 的包清单与构建配置**

`packages/logo/package.json`：

```json
{
  "name": "@needle/logo",
  "version": "0.3.7",
  "description": "结构化日志：批量 sink、stdout / 文件 / IndexedDB / 飞书落地",
  "type": "module",
  "sideEffects": false,
  "license": "MIT",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./node": {
      "types": "./dist/node.d.ts",
      "default": "./dist/node.js"
    }
  },
  "files": [
    "dist"
  ]
}
```

`packages/shell/package.json`：与上面同构，`name` 为 `@needle/shell`，`description` 为 `浏览器 / 扩展里的 Web Shell 面板`，多一段：

```json
"dependencies": {
  "@needle/logo": "workspace:*"
}
```

两个 `tsconfig.build.json` 与 `packages/core/tsconfig.build.json` 完全一致（`extends: "../../tsconfig.json"`，`include: ["src"]`）。

- [ ] **Step 5: 根 `package.json` 改成 workspace 根**

```json
{
  "name": "needle",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build:core": "tsc -p packages/core/tsconfig.build.json",
    "build:logo": "tsc -p packages/logo/tsconfig.build.json",
    "build:ui": "bun scripts/build-ui.mjs",
    "build:shell": "tsc -p packages/shell/tsconfig.build.json",
    "build": "rm -rf packages/*/dist && bun run build:core && bun run build:logo && bun run build:ui && bun run build:shell",
    "demo": "bun run build:logo && bun examples/demo.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "size": "bun build scripts/size-log-only.ts --minify --target=browser | gzip -c | wc -c && bun build packages/shell/src/index.ts --minify --target=browser | gzip -c | wc -c"
  },
  "devDependencies": {
    "@needle/core": "workspace:*",
    "@needle/logo": "workspace:*",
    "@needle/shell": "workspace:*",
    "@types/bun": "^1.4.3",
    "fake-indexeddb": "^6.2.6",
    "happy-dom": "^21.0.4",
    "miniflare": "^4.20260730.0",
    "typescript": "7.0.2"
  }
}
```

删掉原来的 `version`、`description`、`exports`、`files`、`sideEffects`、`license`。

- [ ] **Step 6: 改构建脚本与 hook**

`scripts/build-ui.mjs`：`entrypoints` 改成 `["packages/shell/src/ui/app.ts"]`，`target` 改成 `"packages/shell/src/ui/script.generated.ts"`，日志行里的路径随之更新。

`scripts/size-log-only.ts`：`export { logo } from "../src/index.js";` → `export { logo } from "../packages/logo/src/index.js";`

`.githooks/pre-commit` 的 `git add` 行：

```sh
git add packages/*/dist packages/shell/src/ui/script.generated.ts
```

- [ ] **Step 7: 迁移测试并按映射改写 import**

先搬文件（包清单已在 Step 4 就位，`bun install` 统一放到 Step 11）：

```bash
mkdir -p packages/logo/test packages/shell/test/integration packages/shell/test/workers
# logo（10 个）
git mv test/unit/human.test.ts test/unit/line.test.ts test/unit/time.test.ts \
       test/unit/record.test.ts test/unit/logger.test.ts test/unit/sink.test.ts \
       test/unit/file-sink.test.ts test/unit/log-files.test.ts \
       test/unit/idb-store.test.ts test/unit/lark.test.ts packages/logo/test/
# shell 单元（17 个）
git mv test/unit/auth.test.ts test/unit/builtins.test.ts test/unit/commands.test.ts \
       test/unit/error-contract.test.ts test/unit/exec.test.ts \
       test/unit/fetch-adapter.test.ts test/unit/local.test.ts test/unit/loglist.test.ts \
       test/unit/metrics.test.ts test/unit/page.test.ts test/unit/router.test.ts \
       test/unit/shell.test.ts test/unit/source.test.ts test/unit/sse.test.ts \
       test/unit/table.test.ts test/unit/view.test.ts test/unit/no-hono-coupling.test.ts \
       packages/shell/test/
# shell 集成 + fixtures + workers
git mv test/integration/attach.test.ts test/integration/serve.test.ts \
       test/integration/shell-e2e.test.ts packages/shell/test/integration/
git mv test/integration/workers.test.ts packages/shell/test/integration/workers.test.ts
git mv test/workers/entry.ts packages/shell/test/workers/entry.ts
git mv test/fixtures.ts packages/shell/test/fixtures.ts
rmdir test/unit test/integration test/workers
```

改写规则（同样只改说明符）：

| 文件范围 | 旧 | 新 |
|---|---|---|
| logo 全部测试 | `../../src/logo/X.js` | `../src/X.js` |
| logo `sink.test.ts` | `../../src/index.js` | `../src/index.js` |
| shell 单元 | `../../src/shell/X.js`、`../../src/shell/ui/X.js` | `../src/X.js`、`../src/ui/X.js` |
| shell 单元 / 集成 | `../../src/logo/logo.js`、`../../src/logo/types.js`、`../../src/index.js` | `@needle/logo` |
| shell `error-contract` | `../../src/core/web/responsex.js` | `../src/web/responsex.js` |
| shell 集成 `attach` / `serve` / `shell-e2e` | `../../src/node.js` | `../src/node.js` |
| shell 全部 | `../fixtures.js` | `./fixtures.js` |
| `workers/entry.ts` | `../../src/index.js`；`../../src/shell/index.js`；`../fixtures.js` | `@needle/logo`；`@needle/shell`；`./fixtures.js` |
| `integration/workers.test.ts` | `entrypoints: ["test/workers/entry.ts"]` | `entrypoints: ["packages/shell/test/workers/entry.ts"]` |

`packages/shell/test/no-hono-coupling.test.ts` 的 `ROOT` 改成 `join(import.meta.dir, "..", "..", "..")`；第一条断言改成读根 `package.json` 与三个 `packages/*/package.json` 的 `dependencies` / `devDependencies` 都不含 `hono`；第二条断言改成逐包校验入口表：core `["."]`、logo `[".", "./node"]`、shell `[".", "./node"]`；第三条的扫描根目录改成 `packages` 与 `examples`。

- [ ] **Step 8: 写三个入口边界测试与两份浏览器安全检查**

`packages/logo/test/entry.test.ts`：`import * as logoEntry from "@needle/logo"`、`import * as nodeEntry from "@needle/logo/node"`；断言 `logo.info`、`newLogger`、`createLarkSink`、`createIndexedDbStore` 是 function；断言 `"createServerShell" in logoEntry === false`、`"serve" in logoEntry === false`、`"createFileSink" in logoEntry === false`；断言 `nodeEntry.createFileSink` / `nodeEntry.createLogFiles` 是 function 且 `"logo" in nodeEntry === false`。

`packages/shell/test/entry.test.ts`：`import * as shellEntry from "@needle/shell"`、`import * as nodeEntry from "@needle/shell/node"`；断言 `createServerShell` / `createBrowserShell` / `mountShell` / `createFetchAdapter` 是 function；断言 `"logo" in shellEntry === false`、`"createFileSink" in shellEntry === false`；断言 `nodeEntry.serve` / `nodeEntry.attach` 是 function 且 `"createServerShell" in nodeEntry === false`。

`packages/core/test/entry.test.ts`：`import * as coreEntry from "@needle/core"`；断言 `SortedTable` / `defaultComparer` 是 function，且 `"logo" in coreEntry === false`。

`packages/logo/test/browser-safety.test.ts` 与 `packages/shell/test/browser-safety.test.ts`：沿用原 `test/unit/browser-safety.test.ts` 的 `bundle()` / `expectBrowserClean()`，每份 `ROOT` 都是 `join(import.meta.dir, "..")`（各自的包根），入口固定为 `join(ROOT, "src/index.ts")`，测试名改成包名。

`packages/*/test/exports.test.ts`（logo、shell 各一份）：照 Task 1 的 core 版本，logo 断言 `Object.keys(pkg.exports)` 为 `[".", "./node"]`、`@needle/logo` 有 `createLarkSink` / `createIndexedDbStore`、`@needle/logo/node` 有 `createFileSink` / `createLogFiles`；shell 断言同样两个入口、`@needle/shell` 有 `createServerShell` / `table`、`@needle/shell/node` 有 `serve` / `attach`。

- [ ] **Step 9: 写产物过期兜底测试**

`test/build-fresh.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
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
```

- [ ] **Step 10: 改示例与冒烟测试**

`examples/demo.ts` 的 import：

```ts
import { createServerShell, table } from "../packages/shell/src/index.js";
import { CommandError } from "../packages/shell/src/commands.js";
import { serve } from "../packages/shell/src/node.js";
import { logo } from "@needle/logo";
import { createFileSink, createLogFiles } from "@needle/logo/node";
```

版本号读取改成 `new URL("../packages/shell/package.json", import.meta.url)`。

`test/smoke/node.mjs`：

```js
import { newLogger } from "../../packages/logo/dist/index.js";
import { createServerShell } from "../../packages/shell/dist/index.js";
import { serve } from "../../packages/shell/dist/node.js";

const { version } = JSON.parse(
  readFileSync(new URL("../../packages/shell/package.json", import.meta.url), "utf8"),
);
```

- [ ] **Step 11: `bun install` 后做一次干净构建**

```bash
bun install
bun run build
```

Expected: `packages/core/dist/index.js`、`packages/logo/dist/{index,node}.js`、`packages/shell/dist/{index,node}.js` 全部生成；`packages/shell/src/ui/script.generated.ts` 的 KB 数与拆包前同量级（约 27 KB，允许因 import 路径变化略有差异）。

- [ ] **Step 12: 全量类型检查与测试**

```bash
bunx tsc --noEmit && bun test && node test/smoke/node.mjs
```

Expected: 全 PASS。`bun test` 收集到的测试文件数 = 拆包前 31 个单元 + 4 个集成 + 1 个 workers fixture 的基础上，再新增各包的 entry / exports / browser-safety 与根 `build-fresh`，只增不减；不允许出现「找不到测试」或收集数骤降。

若 `bunx tsc --noEmit` 报 `@needle/logo` 找不到类型：说明 logo 的 dist 没构建或 `bun install` 没建链接，按 `bun install && bun run build` 重来，不要加 `paths` 绕过。

- [ ] **Step 13: 校验版本号来源**

```bash
grep -n "package.json" examples/demo.ts test/smoke/node.mjs
```

Expected: 两处都是 `packages/shell/package.json`。

- [ ] **Step 14: 提交**

```bash
git add -A
git commit -m "refactor: 拆成 core / logo / shell 三个 workspace 包

- logo 承担原根入口的日志 API（含 lark），新增 ./node 子入口
- shell 依赖 logo，web 工具内迁到 shell/src/web
- 构建顺序 core → logo → ui → shell，dist 随源码提交
- 测试随包迁移，新增产物过期兜底检查"
```

---

### Task 3: 文档、记忆与版本

**Files:**
- Modify: `README.md`、`docs/best-practices/{browser-client,chrome-extension,node-server}.md`、`docs/superpowers/specs/2026-10-22-logo-design.md`（只加顶部说明）、`docs/01.memory.md`

**Interfaces:**
- Consumes: Task 2 的包名与入口。
- Produces: 文档与记忆与仓库现状一致；`docs/01.memory.md` 的验收命令更新为新值。

- [ ] **Step 1: 改 README 的入口表与所有 import**

入口表改成四行：

| 你要什么 | 从哪 import |
|---|---|
| 通用数据结构：`SortedTable` | `@needle/core` |
| 日志：`logo` / `newLogger` / `createLarkSink` / `formatTime` / `toHuman` | `@needle/logo` |
| Shell：`createServerShell` / `createBrowserShell` / `mountShell` / `createFetchAdapter` | `@needle/shell` |
| Node 专属：`createFileSink` / `createLogFiles` | `@needle/logo/node` |
| Node 专属：`serve` / `attach` | `@needle/shell/node` |

正文 `@needle/needle/node` → 按符号拆到 `@needle/logo/node` 或 `@needle/shell/node`；`@needle/needle/shell` → `@needle/shell`；`@needle/needle` → `@needle/logo`。安装一节删掉「git 依赖」整段（workspaces 下无法安装子目录包），改成：

```sh
cd ~/needle && bun install && bun run build
cd ~/needle/packages/core && bun link
cd ~/needle/packages/logo && bun link
cd ~/needle/packages/shell && bun link
```

消费方 `bun link @needle/core @needle/logo @needle/shell`。原「`bun link` 只是在项目里写一条 `"@needle/needle": "link:@needle/needle"`」那段要改写成三个包各自的 link 说明；文件 sink 那段里的 `@needle/needle/node` 改 `@needle/logo/node`，测试路径 `test/unit/browser-safety.test.ts` 改成 `packages/*/test/browser-safety.test.ts`。跑 `bun run size` 后若数字变化，同步 README 第一段的体积数字。

- [ ] **Step 2: 改 best-practices 三篇**

按 Step 1 同一张表替换 import；`node-server.md` 里 Workers 示例的 `package.json` 依赖示例改成三个包；凡是提到「一个包 / 三个入口」的句子改成三个包的说法。

- [ ] **Step 3: 给旧 spec 加取代说明**

`docs/superpowers/specs/2026-10-22-logo-design.md` 第一行加：

```md
> **已被取代（2026-10-24）**：包结构以 `2026-10-24-three-packages-design.md` 为准；本文其余运行时设计仍然有效。
```

- [ ] **Step 4: 更新 `docs/01.memory.md`**

- 「关键决策」新增一条（含两个原因）：
  `**2026-10-24 拆成 @needle/core / @needle/logo / @needle/shell 三个 workspace 包，无伞包。** 两个目的：模块拆小让 AI review / 写码时边界可见、单次上下文变小；边界由包解析硬约束，杜绝循环引用（shell → logo，core 无依赖）。core 只留 SortedTable；web 工具内迁 shell；Node 能力按包出 ./node；构建顺序 core → logo → ui → shell；dist 三份各自提交。spec：docs/superpowers/specs/2026-10-24-three-packages-design.md。`
- 旧的「合成单包 `@needle/needle`，三个入口」条目删除。
- 「目录」条目改写为三包路径与各包入口。
- 文件索引里的验收命令改成：
  `bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs`
- 「AGENTS.md 建议」新增：
  `[AGENTS.md 建议] §14 的版本号来源改为「三个包的 package.json」，并说明产品版本看 packages/shell；§13.3 的 VERIFY 按上面新值。`

- [ ] **Step 5: 自查残留**

```bash
grep -rn "@needle/needle\|src/logo\|src/shell\|src/core" README.md docs/ | grep -v "specs/2026-10-2"
```

Expected: 只剩历史 spec 与本次设计/计划文档里的正当提及。

- [ ] **Step 6: 提交**

```bash
git add README.md docs/
git commit -m "docs: 同步三包拆分后的 import 与安装方式"
```

---

### Task 4: 硬边界验收

**Files:**
- 无源码改动；只跑命令，发现问题回到对应任务修。

**Interfaces:**
- Consumes: Task 2 / 3 的产物。
- Produces: 拆包边界为真、无残留的证据。

- [ ] **Step 1: 证明包边界是硬的**

```bash
rm -rf packages/logo/dist packages/shell/dist
bun run build:shell; echo "rc=$?"
```

Expected: 非零退出，错误指向找不到 `@needle/logo` 的类型/入口。随后 `bun run build` 恢复三份 dist。

- [ ] **Step 2: 证明构建顺序不是摆设**

```bash
rm -rf packages/*/dist
bun run build:core && bun run build:logo && bun run build:ui && bun run build:shell
```

Expected: 全绿；`packages/shell/src/ui/script.generated.ts` 被重写。

- [ ] **Step 3: 全量验收**

```bash
bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs
```

Expected: 全绿。

- [ ] **Step 4: 残留扫描**

```bash
grep -rn "@needle/needle" --include='*.ts' --include='*.js' --include='*.mjs' --include='*.json' --include='*.md' . \
  --exclude-dir=node_modules --exclude-dir=.git | grep -v "specs/2026-10-2" | grep -v "plans/2026-10-24"
ls src dist 2>&1 | head
```

Expected: 第一条无输出（历史 spec 与本次设计/计划除外）；第二条两个目录都不存在。

- [ ] **Step 5: 版本与工作区自检**

```bash
git ls-files 'packages/*/dist/*' | wc -l
node -e 'for (const p of ["core","logo","shell"]) console.log(p, require(`./packages/${p}/package.json`).version)'
```

Expected: dist 文件已入库且数量不为 0；三行都是 `0.3.7`。

- [ ] **Step 6: 收尾提交（仅当上面步骤产生了改动）**

如果 `git status --porcelain` 非空（例如重建的 dist 与 UI 脚本内容有变），提交它们：

```bash
git add -A
git commit -m "chore: 验收重建产物"
```

若工作树干净则跳过本步。版本号已在 Task 2 从 `0.3.6` 提到 `0.3.7`，本步不再 bump。
