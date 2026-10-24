# 三包拆分设计：@needle/core / @needle/logo / @needle/shell

> **2026-10-25 更新：`core` 包已改名为 `got`（`@needle/got`，目录 `packages/got`，构建脚本 `build:got`）。** 本文正文保留 2026-10-24 当时的写法，不改写历史；当前包结构以 `docs/01.memory.md` 为准，除包名外本文其余内容仍然有效。

日期：2026-10-24
状态：已批准（2026-10-24）

## 1. 意图

现在是一个包 `@needle/needle` + 三个入口（`.` 日志、`./shell`、`./node` 聚合）。边界靠目录约定和测试约束，包名不表达边界：想只用 `SortedTable` 的人也得装整个日志 + Shell。

拆成三个真包，import 说明符本身就是边界：

- `@needle/core` —— 通用数据结构，目前只有 `collections/sorted-table.ts`。
- `@needle/logo` —— 结构化日志（原 `src/logo` + 原根入口）。
- `@needle/shell` —— 浏览器 / 扩展里的 Web Shell 面板（原 `src/shell`）。

为什么现在做（两个原因，人类原话）：

1. **把模块拆小，边界才看得见。** 单包 + 三入口时，边界只存在于目录约定和测试里；人和 AI 读代码、写代码、review 时都要先在脑子里重建这张边界图。包一拆，依赖关系由 `package.json` 和路径写法直接表达，单次 review / 改动的上下文变小，不会因为模块太大把设计复杂度顶上去。
2. **把边界拆干净，才不会有循环引用。** 三个包的单向依赖（`shell → logo`，`core` 谁都不靠）由构建顺序和包解析硬约束：谁反向引用，谁就构建不过，而不是等 review 时靠人盯。

时机：包还没发 npm，没有外部消费者，breaking 成本最低；`core` 目前只被自己的测试用，剥离零风险。

## 2. 目标

1. 三个独立 package（各自 `package.json`、`tsconfig.build.json`、`dist/`），bun workspaces 管理；版本号统一由根 `package.json` 提供（见 §11）。
2. 删掉伞包 `@needle/needle`，不保留兼容入口。
3. `core` 只含 Collections（`SortedTable`），不含任何 `web/` 工具。
4. 依赖方向严格：`core` 无依赖，`logo` 无依赖，`shell` → `logo`。
5. Node 专属能力按包出：`@needle/logo/node`、`@needle/shell/node`。
6. 全部源码、测试、示例、文档、构建脚本的路径与 import 同步更新；验收命令全绿。

## 3. 非目标

- 不改任何运行时行为、命令语义、UI、日志格式、HTTP 契约。
- 不借机重构实现代码（除 import 路径与目录搬迁必需的最小改动）。
- 不引入新依赖、不引 monorepo 工具（turbo/nx）。
- 不发 npm。

## 4. 反目标（即使技术上跑通也算失败）

- 拆完后 `bun run build` 的顺序可以任意打乱而不报错——说明包边界没真正建立。
- shell 包内部仍靠相对路径穿透到 logo 的源码目录。
- 测试为了绕开构建去引用别的包的源码，造成同一模块在测试里出现两个单例。
- 只改源码路径、`dist/` 里还留着旧包结构的产物。

## 5. 已定决策

人类拍板（2026-10-24 本轮对话）：

| 决策 | 结论 |
|---|---|
| 包名 | `@needle/core` / `@needle/logo` / `@needle/shell`，无伞包 |
| `src/core/web/{body,responsex}.ts` | 搬进 shell（core 只留 Collections） |
| Node 能力 | 各包自己出：`@needle/logo/node` + `@needle/shell/node`，删掉聚合 `./node` |
| 工程形态 | bun workspaces，`packages/{core,logo,shell}`，各自 `dist/` 提交 |
| 拆法 | A：包内测试相对引用本包源码；跨包一律包名（走 dist） |

本轮由实现者决定、人类未反对：

- 版本号单源：根 `package.json` 的 `version` 是唯一来源，三个包的 `version` 由脚本同步成同一个值（2026-10-24 修订，见 §11）。
- 包内目录去掉重复层级：`packages/logo/src/*.ts`（不再有 `src/logo/`），`packages/shell/src/*.ts`（不再有 `src/shell/`）。
- `@needle/core` 只导出 `SortedTable`、`Comparer`、`defaultComparer`，只有 `.` 一个入口。
- `web/body.ts`、`web/responsex.ts` 搬进 `packages/shell/src/web/`，不对外导出（外部拿不到，也不需要）。
- 生产依赖只有一条：`packages/shell/package.json` 里 `"@needle/logo": "workspace:*"`。根 `package.json` 额外把三个包声明为 `devDependencies`（同样 `workspace:*`），只为了让根目录的 `examples/demo.ts` 与根级测试能按包名解析；这是开发期链接，不是发布依赖，也不改变「无伞包」。其余（`@types/bun`、`happy-dom`、`fake-indexeddb`、`miniflare`）是开发依赖，留在根 `package.json`。

## 6. 目标仓库结构

```
package.json                 # private: true, workspaces: ["packages/*"], 只放脚本与 devDependencies
tsconfig.json                # 全仓 noEmit 类型检查
bun.lock
.githooks/pre-commit
scripts/
  build-ui.mjs               # 产物写到 packages/shell/src/ui/script.generated.ts
  size-log-only.ts           # 改为从 packages/logo/src/index.ts 取 logo
examples/demo.ts             # 日志侧走包名（dist），Shell 侧引 packages/shell/src
test/
  smoke/node.mjs             # 唯一留在根目录的测试：对三份 dist 产物做冒烟
packages/
  core/
    package.json  tsconfig.build.json
    src/index.ts
    src/collections/sorted-table.ts
    test/sorted-table.test.ts
    dist/                    # 提交
  logo/
    package.json  tsconfig.build.json
    src/index.ts  src/node.ts
    src/{logo,line,record,human,log-files,types}.ts
    src/sinks/{stdout,file,idb,lark}.ts
    test/*.test.ts
    dist/                    # 提交
  shell/
    package.json  tsconfig.build.json
    src/index.ts  src/node.ts
    src/{auth,authenticate,builtins,commands,exec,metrics,page,router,source,sse,table,types}.ts
    src/web/{body,responsex}.ts
    src/ui/*.ts
    test/*.test.ts  test/fixtures.ts  test/workers/entry.ts
    dist/                    # 提交
```

旧的 `src/`、根 `dist/`、`test/unit`、`test/integration`、`test/workers`、`test/fixtures.ts` 全部消失（内容迁移到上表位置）；只有 `test/smoke/node.mjs` 留在根。

## 7. 包契约

| 包 | 入口 | 内容 |
|---|---|---|
| `@needle/core` | `.` | `SortedTable` / `Comparer` / `defaultComparer` |
| `@needle/logo` | `.` | 现有伞包根入口的日志部分：`src/logo/index.ts` 的全部导出 **加上** 现在由 `src/index.ts` 单独转出的 `createLarkSink` / `LarkSink` / `LarkSinkOptions`（即今天 `.` 减去 `SortedTable`） |
| `@needle/logo` | `./node` | `createFileSink` / `createLogFiles` 及其类型 |
| `@needle/shell` | `.` | 现有 `src/shell/index.ts` 的全部导出 |
| `@needle/shell` | `./node` | `serve` / `attach` 及其类型 |

`@needle/core` 没有任何 workspace 依赖者，按包名 import 靠 Node/Bun 的**包自引用**（`name` + `exports` 已满足），不需要为验证在根 `package.json` 里额外加一条 workspace 依赖。已在 bun 1.4.2 实测：workspace 里零依赖的包，其自身 `test/` 中 `import "@pkg/name"` 可解析。

每个 `package.json` 都声明 `"type": "module"`、`"files": ["dist"]`、`"sideEffects": false`、`license: MIT`、`exports` 的 `types` 与 `default` 双指 `dist/`。`@needle/logo` 的 `./node` 与 `@needle/shell` 的 `./node` 是唯一允许触达 `node:` 的入口。

## 8. 依赖方向与浏览器安全

- `packages/core`：不 import 任何 workspace 包，不碰 `node:`。
- `packages/logo`：不 import 任何 workspace 包。`.` 入口及 `sinks/{stdout,idb,lark}.ts` 不碰 `node:`；只有 `./node`（`sinks/file.ts`、`log-files.ts`）碰。
- `packages/shell`：源码只从 `@needle/logo` 取日志能力；`.` 入口不碰 `node:`，只有 `./node`（`node.ts`）碰。

三道闸保持并各自归位：

1. `browser-safety.test.ts` 拆成两份（logo 包一份、shell 包一份），各自对 `bun build --target=browser` 的产物做 `node:` / `require(` / 动态 `import(` 内容断言。
2. `entry.test.ts` 拆成三份（core / logo / shell），断言各入口只出自己该出的东西，且不转手导出依赖。
3. `no-hono-coupling.test.ts` 搬到 shell 包，改为扫描 workspace 三个 `package.json` 与全部 `packages/*/src`、`examples`：无 hono 依赖、无框架适配入口。

## 9. 构建与验证

- `tsconfig.json`（根，`noEmit`）：`include` 改为 `packages/*/src`、`packages/*/test`、`test`、`examples`、`scripts`。
- 每个包 `tsconfig.build.json`：`extends: "../../tsconfig.json"`，覆盖 `noEmit: false`、`rootDir: "src"`、`outDir: "dist"`、`declaration: true`，`include: ["src"]`。
- 构建顺序固定 `core → logo → ui → shell`：
  - shell 的 tsc 通过 `node_modules/@needle/logo` 的 `exports.types` 读 logo 的 `dist/*.d.ts`；
  - **UI 打包也依赖 logo**：`packages/shell/src/ui/*` 会 import `@needle/logo`，`build-ui.mjs` 用 Bun.build 按包名解析，同样落到 logo 的 `dist/*.js`。所以 `build:ui` 必须排在 `build:logo` 之后，否则一次干净构建直接失败。
  根脚本：
  - `build:core` / `build:logo` / `build:shell`
  - `build:ui` → `bun scripts/build-ui.mjs`（写 `packages/shell/src/ui/script.generated.ts`）
  - `build` = `rm -rf packages/*/dist && build:core && build:logo && build:ui && build:shell`
- `bun install` 重建 workspace 符号链接并更新 `bun.lock`（拆包后必须执行一次）。
- 测试发现：根目录 `bun test` 递归收集 `packages/*/test` 与 `test/`，不需要额外配置。
- 验收命令（写入 `docs/01.memory.md`，替换旧值）：
  `bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs`
- `test/smoke/node.mjs` 改读三份 dist：`packages/logo/dist/index.js`、`packages/shell/dist/index.js`、`packages/shell/dist/node.js`；版本号读根 `package.json`。
- `examples/demo.ts`：`logo` / `createFileSink` / `createLogFiles` 用包名（`@needle/logo`、`@needle/logo/node`，解析到 dist），Shell 侧引 `../packages/shell/src/*` 源码。理由是**单例**：shell 源码内部 import `@needle/logo`，demo 必须拿同一个 dist 实例，否则 sink 加在另一个 logger 上、页面看不到日志。版本号读根 `package.json`。根脚本 `demo` = `bun run build:logo && bun examples/demo.ts`：改 logo 后要重建，改 shell/UI 不必。
- `.githooks/pre-commit`：先 `bun run version:sync`（把根版本写进三个包），再 `bun run build`，最后 `git add packages/*/package.json packages/*/dist packages/shell/src/ui/script.generated.ts`。

## 10. 跨包与 dist 的代价（必须写进文档，不准藏）

拆法 A 的必然结果：shell 的源码与测试在运行时都通过包名解析到 **logo 的 dist**。因此：

- 改了 `packages/logo/src` 之后，必须 `bun run build:logo` 才能让 shell 的测试与 `examples/demo.ts` 看到新代码；否则测试跑的是旧产物，可能静默通过。
- 同一份 logo 在 shell 测试里只出现一次（都来自 dist），不会出现两个单例——这正是禁止测试跨包相对引用源码的原因。
- 兜底：根目录加一条 `test/build-fresh.test.ts`，覆盖三处：`packages/{core,logo,shell}/src` 最新 mtime 对比各自 `dist/index.js`，以及 `packages/shell/src/ui/*.ts` 对比 `script.generated.ts`（比对时排除 `script.generated.ts` 自身）。过期则失败并提示对应的 `build:*` 命令。给 2 秒容差：刚 clone / checkout 时 mtime 同批写入，不误报。
- `examples/demo.ts` 因此把日志侧写成包名（解析到 dist）、Shell 侧引源码：这样 logger 单例只有一份，改 UI 不必重建。根脚本 `demo` = `bun run build:logo && bun examples/demo.ts`。

## 11. 版本号与提交规则

- **单一来源：根 `package.json` 的 `version`。** 根是 `private: true` 的工作区根，但保留 `version` 字段；三个包的 `version` 必须与它完全相等。
- `package.json` 不支持字段引用（没有 `version: "workspace:root"` 这类写法），所以用机械同步：`bun run version:sync` 读根版本、写进 `packages/{core,logo,shell}/package.json`，只在不一致时改文件。
- 同步挂在 `.githooks/pre-commit` 里、构建之前；产物与三个 `package.json` 一起进同一个 commit。
- 兜底测试 `test/version-lock.test.ts`：根必须有 `version`，且三包版本与根逐字相等。忘了跑同步，测试直接红。
- 改版本只改根一处，按 §14「每次合并进 main 把 patch +1」执行（`0.3.7` → `0.3.8` 是本次修订的 bump）。
- `examples/demo.ts` 与 `test/smoke/node.mjs` 都读根 `package.json`。
- `AGENTS.md` §14 与 §13.3 `VERIFY` 的措辞仍需人类改（agent 不自行改 AGENTS.md）：§14 明确「根 `package.json` 是唯一来源，三包由 `bun run version:sync` 同步」；`VERIFY` 取值按第 9 节。

## 12. 迁移映射

目录搬迁用 `git mv` 保留历史。核心映射：

| 旧 | 新 |
|---|---|
| `src/core/collections/sorted-table.ts` | `packages/core/src/collections/sorted-table.ts` |
| `src/index.ts` | `packages/logo/src/index.ts` |
| `src/logo/**` | `packages/logo/src/**`（去掉 `logo/` 层） |
| `src/node.ts` | `packages/logo/src/node.ts`（只留 file sink + log-files） |
| `src/shell/**` | `packages/shell/src/**`（去掉 `shell/` 层） |
| `src/core/web/*` | `packages/shell/src/web/*` |
| `src/shell/node.ts` | `packages/shell/src/node.ts` |
| `test/unit/<按包归属>` | `packages/<pkg>/test/` |
| `test/integration/*`、`test/workers/entry.ts`、`test/fixtures.ts` | `packages/shell/test/`（workers 用例一并搬，因为它构建的是 shell + logo） |
| `test/smoke/node.mjs` | 留在根，改 dist 路径 |

单元测试归属：`sorted-table` → core；`human`/`line`/`time`/`record`/`logger`/`sink`/`file-sink`/`log-files`/`idb-store`/`lark` → logo；其余（`auth`/`builtins`/`commands`/`exec`/`error-contract`/`fetch-adapter`/`local`/`loglist`/`metrics`/`page`/`router`/`shell`/`source`/`sse`/`table`/`view`/`no-hono-coupling`）→ shell。`entry`/`exports`/`browser-safety` 三份按包拆开。

## 13. 破坏性影响

1. **所有 import 说明符改变**：`@needle/needle` → `@needle/logo`，`@needle/needle/shell` → `@needle/shell`，`@needle/needle/node` → `@needle/logo/node` 或 `@needle/shell/node`。README、`docs/best-practices/*`、示例全部同步改。
2. **Git 依赖方式失效**：bun workspaces 的 git 安装拿不到子目录里的包。当前 README 的「git 依赖」安装法必须删掉，改为「本地 `bun link` 三个包」；发 npm 之后才有多项目安装方案。
3. `docs/superpowers/specs/2026-10-22-logo-design.md` 描述的单包三入口已过时：在文件顶部加一行「已被本文取代，包结构以本文为准」，不改写历史正文。
4. `docs/01.memory.md` 的目录决策、文件索引、验收命令同步更新；旧的「合成单包 @needle/needle」条目改写成三包结构。

## 14. 风险

| 风险 | 处置 |
|---|---|
| shell 测试/示例/类型检查读到过期产物 | 先构建后验；根 `test/build-fresh.test.ts` 覆盖三包 + UI 脚本；文档写明 |
| workspace 符号链接没建立导致解析失败 | 标准流程第一步就是 `bun install`，验收命令包含它 |
| `git mv` 后 Bun test 的发现路径变化 | `bun test` 跑一遍确认收集到全部 38 个测试文件（迁移前后数量一致） |
| pre-commit 构建时间变长（三次 tsc） | 可接受；不为此引入增量构建工具 |
| 三个 dist 提交让 diff 变大 | 既有约定；`dist` 本来就在仓库里 |

## 15. 留给 builder 的

- `git mv` 的先后顺序、每次移动后跑哪条命令，交给 plan。
- `build-fresh.test.ts` 的具体写法（mtime 比较的容差）交给实现者。
- 文档改写的批次划分交给 plan；文案口径沿用「产品名统一叫 Shell」等既有决策。

## 16. 实施后检查清单

1. `bun install && bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs` 全绿。
2. 边界是硬的：`rm -rf packages/logo/dist packages/shell/dist && bun run build:shell` 必须非零退出（logo 的 `.d.ts` 不存在）。注意 dist 已提交，不先删就永远绿——这条检查必须带 `rm`。
3. 三个 `package.json` 的 `exports` 指向的文件真实存在，且用包名 import 能拿到对应 API。
4. 浏览器打包产物检查：`@needle/logo` 与 `@needle/shell` 的 `.` 入口无 `node:`。
5. 仓库里不再出现 `@needle/needle`、`src/logo`、`src/shell`、`src/core`、根 `dist/` 的残留引用。
6. 根 `package.json` 有 `version`，三个包的 `version` 与它相等（`test/version-lock.test.ts` 钉住）。

## 17. 评审后修订（2026-10-24）

独立 reviewer 读出的六个问题及结论，已并入上文：

| # | 问题 | 结论 |
|---|---|---|
| 1 | `build:ui` 与 `build:logo` 的先后：UI 源码要 import `@needle/logo` | 顺序改为 `core → logo → ui → shell`，见 §9 |
| 2 | logo `.` 漏了 `createLarkSink`（它今天由伞包根入口单独转出） | logo `.` = 今天 `.` 减去 `SortedTable`，显式包含 lark 三件套，见 §7 |
| 3 | dist 已提交，单跑 `build:shell` 不会失败，§16.2 是假门禁 | 改为先 `rm -rf packages/logo/dist packages/shell/dist` 再跑，见 §16.2 |
| 4 | 产物过期只给 logo 上保险不够 | `build-fresh.test.ts` 放宽到三包 + UI 脚本，放根 `test/`，见 §10 |
| 5 | 版本号唯一来源在拆包后指谁 | 2026-10-24 再修订：根 `package.json` 拥有 version，三包由脚本同步，见 §11 |
| 6 | core 无依赖者，按包名 import 能否解析 | 靠包自引用，bun 实测通过；不加额外 workspace 依赖，见 §7 |
