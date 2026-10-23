# 浏览器日志落 IndexedDB 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浏览器端日志落 IndexedDB，`log.list` 在浏览器里列出虚拟文件、点开全文、文件名 hover 出末尾样本（服务端同享 tips）。

**Architecture:** `createIndexedDbStore()` 产出 `Sink & LogFiles & { close }` 的双身份对象，写路径走 sink 批量事务，读路径复用既有 `logFiles` 端口（`BrowserShellOptions` 零签名变更）；tips 采用 GONSOLE 同款「列表自带 sample + 纯 CSS hover」。

**Tech Stack:** TypeScript（strict, nodenext）、IndexedDB、`bun:test`、`fake-indexeddb`（devDependency，IDB 的标准测试替身：MIT、活跃维护、Dexie 等生态在用——Bun 里没有真 IDB 可测）。

**Spec:** `docs/superpowers/specs/2026-10-23-browser-log-store-design.md`

## Global Constraints

- 代码风格（AGENTS.md 末节）：控制流强制花括号、语句体独占多行、`else` 跟在 `}` 后。
- `src/logo` 下禁止 import `../shell`；根入口与 `./shell` 禁止任何 `node:`（`browser-safety` / `no-hono` 测试钉住打包产物）。
- 每个 magic number 带注释说明取值理由；单方法 ≤ 50 行。
- TDD：每个行为先写测试、看红、再实现、看绿；不红不写实现。
- commit：subject ≤ 72 字符，body 讲为什么。
- 验收命令（docs/01.memory.md）：`bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs`。
- 子代理禁止 merge / push / rebase / 删 worktree（本次 native 执行，无子代理提交；合并由主会话按 AGENTS.md §13 执行）。

## Review Focus

1. **open 未完成就写**（页面启动即写日志）——批次必须排队不丢。→ Task 2 步骤「立即写」测试钉住。
2. **无痕模式 / WebView 无 `indexedDB`**——写不抛错、list 返回 `[]`、read 返回 `null`。→ Task 2 降级测试。
3. **样本含 `<script>` 与换行**——必须 textContent 渲染，不能 innerHTML。→ Task 3 测试断言无 script 元素且文本原样。
4. **href 带编码字符 / query**（`/log/a%20b.log?x=1`）——本地拦截要解 query、解码文件名。→ Task 4 测试。
5. **同批 warn+error 的级联与顺序**——info.log 收全、warn.log 收 warn+error、error.log 只收 error，顺序 = 入库顺序。→ Task 2 级联测试。

---

### Task 1: `LogFileEntry.sample` 与 Node 侧尾读

**Files:**
- Modify: `src/logo/types.ts`（`LogFileEntry` 加 `sample?: string`）
- Modify: `src/logo/log-files.ts`（`list()` 填 sample）
- Test: `test/unit/log-files.test.ts`（新建）

**Interfaces:**
- Produces: `LogFileEntry.sample?: string`——该文件末尾 5 行，`\n` 分隔、每行截 200 字符；后续 Task 3 的 `log.list` 与浏览器 store 都依赖这个字段语义。

- [ ] **Step 1: 写失败测试**

```ts
// test/unit/log-files.test.ts —— 临时目录 + createLogFiles({ dir })
// 常量：末尾 5 行、每行截 200 字符（与 spec §5.3 一致）
test("list 返回的 entry 带末尾 5 行 sample")           // 写 10 行 → sample 恰为最后 5 行
test("文件不足 5 行时 sample 为全部行")                // 写 2 行 → 2 行
test("空文件 sample 为空字符串")                        // ""（而非 undefined：文件存在但没内容）
test("超长行截断到 200 字符")                          // 300 字符行 → sample 中该行 length === 200
test("读不了的文件 sample 缺省")                        // 目录里放一个同名目录 info.log/ → entry 无 sample 键
```

- [ ] **Step 2: 跑红** —— `bun test test/unit/log-files.test.ts`，FAIL（`sample` 不存在）。
- [ ] **Step 3: 实现** —— `log-files.ts` 内 `readTailSample(handle, size)`：从 `size - 4096`（文件小于 4096 则从头；4096 = 5 行典型日志行的宽松窗口，行更长时取窗口内完整行）读到 EOF，utf8 解码，按 `\n` 拆，丢弃窗口开头被截断的半行（仅当文件大于窗口），取最后 5 条非空行，每行截 200 字符。
- [ ] **Step 4: 跑绿** —— `bun test test/unit/log-files.test.ts` PASS，再跑全量 `bun test`。
- [ ] **Step 5: Commit** —— `git add -A && git commit -m "feat(logo): LogFiles.list 带文件末尾样本 sample"`。

### Task 2: `createIndexedDbStore`

**Files:**
- Create: `src/logo/sinks/idb.ts`
- Modify: `src/logo/index.ts`（导出 `createIndexedDbStore` / 类型）
- Test: `test/unit/idb-store.test.ts`（新建，`import "fake-indexeddb/auto"`）

**Interfaces:**
- Consumes: `Sink` / `LogFiles` / `LogRecord` / `Level`（`src/logo/types.ts`）、`formatLine`（`src/logo/line.ts`）、`LEVELS`。
- Produces（从根入口 `@needle/needle` 导出，签名逐字）:

```ts
export interface IndexedDbStoreOptions {
  name?: string;        // 默认 "needle-logs"
  keepDays?: number;    // 默认 7
  maxRecords?: number;  // 默认 5000
  minLevel?: Level;     // 默认 "info"，低于级别写入时丢弃
  now?: () => number;   // 测试注入
}
export type LogStore = Sink & LogFiles & { close(): void };
export function createIndexedDbStore(options?: IndexedDbStoreOptions): LogStore;
```

- 前置步骤：`bun add -d fake-indexeddb`（package.json + bun.lock 随本任务提交）。

- [ ] **Step 1: 写失败测试**（`test/unit/idb-store.test.ts`，记录 `level/msg/time` 的 helper 复用 file-sink 测试风格）：

```ts
test("写入与级联：info.log 收全、warn.log 收 warn+error、error.log 只收 error")  // read() 断言行数与 msg
test("立即写：create 后马上 sink，open 完成后 list() 能看到")                     // sink 后直接 await list()
test("低于 minLevel 的记录写入时丢弃")                                            // 只有 debug 记录 + 默认 minLevel → list() 为 []
test("minLevel: debug 时 debug.log 出现且级联")                                   // 4 个虚拟文件
test("某级别 0 条记录时不列该文件")                                               // 只有 info → 无 warn.log/error.log
test("sample 是末尾 5 行且每行 ≤200 字符")                                        // 7 条记录 → sample 5 行 === read() 最后 5 行
test("超过 maxRecords 按入库顺序删最旧")                                          // maxRecords:10 写 15 → info.log 10 行
test("keepDays 过期的记录被清理")                                                 // now 注入，写一条 8 天前的 → 下次写入后 read 无它
test("read 名单外返回 null")                                                      // read("bogus.log") === null
test("无 indexedDB 时降级：写不抛、list 为 []、read 为 null")                     // 删 globalThis.indexedDB，测完还原
test("close 后 sink 不再写、list 返回 []")
```

- [ ] **Step 2: 跑红** —— `bun test test/unit/idb-store.test.ts`，FAIL（模块不存在）。
- [ ] **Step 3: 实现**（要点，body 由测试驱动）：
  - `ready = openDb()`：`indexedDB.open(name, 1)`，`onupgradeneeded` 建 store `records`（keyPath `id`，autoIncrement）+ 索引 `by_time`（"time"）。打开失败 / 全局缺失 → `failed = true`，此后写静默（fire-and-forget + catch，`console.error` 只报一次——对齐 `logo.ts` 的 `reportSinkError` 口径）、读返回空。
  - 写路径串在一条 promise 链上（保序）：每批一个 `readwrite` 事务：`put` 每条 → `count()` 超限则游标按主键删最旧 → `by_time` 游标 `upperBound(now - keepDays*86400000)` 删过期。事务内完成，一次 commit。
  - 读路径 `collect()`：readonly 事务 `getAll()` 一趟，在 JS 里按 `LEVELS` 级联分桶、`formatLine` 拼行；`list()` 由同一趟产出 entries（`modified` = 桶内最大 time；`size` = 桶内行字节数合计；`sample` = 末尾 5 行——精确值，优于估算）。
  - `read(name)` 白名单：候选 = `["debug","info","warn","error"]` 中 `>= minLevel` 的 `<level>.log`，不在候选 → `null`。
  - `close()`：置 `closed`，`db.close()`。
- [ ] **Step 4: 跑绿** —— 单文件 PASS，全量 `bun test` PASS；`bunx tsc --noEmit` PASS。
- [ ] **Step 5: 更新 `test/unit/exports.test.ts`**（如它枚举导出清单，把 `createIndexedDbStore` 补进去；先读该测试再改）。
- [ ] **Step 6: Commit** —— `feat(logo): createIndexedDbStore 浏览器日志存储（Sink+LogFiles）`。

### Task 3: tips（`LinkedCell.tip` + 渲染 + CSS + `log.list` 接线）

**Files:**
- Modify: `src/shell/types.ts`（`LinkedCell` 加 `tip?: string`）
- Modify: `src/shell/ui/table.ts`（`tableCell` 的 link 分支）
- Modify: `src/shell/ui/style.ts`（追加 `.tips` CSS）
- Modify: `src/shell/builtins.ts`（`createLogListCommand` 的 file 单元格带 `tip: entry.sample`）
- Test: `test/unit/table.test.ts`、`test/unit/builtins.test.ts`（各自追加）

**Interfaces:**
- Consumes: `LogFileEntry.sample`（Task 1）。
- Produces: `LinkedCell.tip?: string`——有值时单元格渲染为 `span.tips` 包 `a` + `span.tips_text`（textContent），hover 经 CSS 显示。

- [ ] **Step 1: 写失败测试**

```ts
// table.test.ts
test("带 tip 的链接渲染 tips_text，纯文本不解析 HTML")   // tip: '<b>x</b>\n第二行' → 无 <b> 元素、textContent 含换行与原文
test("无 tip 的链接不包 tips 容器")                       // 现有行为不回归
// builtins.test.ts
test("log.list 把 entry.sample 填进 file 单元格的 tip")   // stub logFiles，断言 table rows
```

- [ ] **Step 2: 跑红。**
- [ ] **Step 3: 实现** —— `tableCell` link 分支：有 `tip` 时包 `span.tips`，链接后追加 `span.tips_text`，`textContent = tip`；CSS 取 GONSOLE 结构（`.tips{position:relative}`、`.tips_text{visibility:hidden; position:absolute; white-space:pre-wrap; ...}`、`.tips:hover .tips_text{visibility:visible}`），配色用 Solarized 变量（`--bg-alt` 底、`--text-strong` 字），不用 GONSOLE 的硬编码色值；`builtins.ts` file 单元格 `...(entry.sample ? { tip: entry.sample } : {})`。
- [ ] **Step 4: 跑绿** —— 两个测试文件 + 全量 `bun test` PASS。
- [ ] **Step 5: Commit** —— `feat(shell): log.list 文件名 hover 显示末尾样本（LinkedCell.tip）`。

### Task 4: 本地适配器 `fetchFile` 拦截 `/log/:name`

**Files:**
- Modify: `src/shell/ui/local.ts`
- Test: `test/unit/local.test.ts`（追加）

**Interfaces:**
- Consumes: `ShellSource.logFiles`（既有）、Task 2 的 store 作为 `logFiles` 传入。
- Produces: `fetchFile(href)`——`/log/<name>` 走 `source.logFiles.read(decodeURIComponent(name))`；其余 href 维持现有失败文案。

- [ ] **Step 1: 写失败测试**

```ts
test("fetchFile 拦截 /log/:name 直读 logFiles")            // stub read → {ok:true,text}
test("文件不存在时返回 ok:false")                            // read → null → ok:false
test("未配置 logFiles 时返回提示")                           // 现有 setup（无 logFiles）→ ok:false
test("非 /log/ 的 href 维持失败")                            // "/other" → ok:false
test("文件名带编码字符与 query 正确解析")                    // "/log/a%20b.log?x=1" → read 收到 "a b.log"
```

- [ ] **Step 2: 跑红。**
- [ ] **Step 3: 实现** —— `fetchFile`：取 href 的 path 段（剥 query/hash），正则 `^/log/(.+)$`，`decodeURIComponent`（try/catch 包住，失败按不存在处理）；`source.logFiles` 缺失或 `read` 为 null → `{ ok:false, error }`（文案区分「未配置」与「不存在」）。
- [ ] **Step 4: 跑绿** —— local 测试 + 全量 `bun test` PASS。
- [ ] **Step 5: Commit** —— `feat(shell): 本地模式 fetchFile 支持 /log/:name 读取日志`。

### Task 5: 文档

**Files:**
- Modify: `docs/best-practices/browser-client.md`（「日志」节加「落本机 IndexedDB」小节：两行接线、`batch: true` + `flushIntervalMs: 16`、`pagehide` flush、降级说明、敏感数据提示；sendBeacon 段保留为「发远端」选项）
- Modify: `docs/best-practices/chrome-extension.md`（「三、日志」加：扩展页面与 SW 共享 origin 的同一 IDB、SW 各自 `addSink`、content script 不行（IDB 属宿主页）、「清除浏览数据」不清扩展 storage）
- Modify: `README.md`（`log.list` 行与 §一 里「磁盘」表述改为「Node 读磁盘、浏览器读 IndexedDB」两处）

**Interfaces:** 无代码接口；文档与实现口径一致（选项名、默认值、命令名逐字对齐）。

- [ ] **Step 1: 按上述内容改三篇文档**（默认值逐字核对 `idb.ts` 实现）。`browser-client.md` 带上 spec §5.6 已知限制四条（崩溃丢尾部一个攒批窗口、sendBeacon 仍是发远端唯一可靠出口、时钟前跳成批误删、read 无字节护栏）。
- [ ] **Step 2: 自查** —— 文档里的示例代码与 Task 2/4 的真实签名一致；无新增「常见坑」复述代码注释已覆盖的内容。
- [ ] **Step 3: Commit** —— `docs: 浏览器/扩展日志落 IndexedDB 用法`。

### Task 6: 版本号与全量验收

**Files:**
- Modify: `package.json`（`0.3.3` → `0.3.4`，§14：随分支最后一个提交 bump 一次）

- [ ] **Step 1: bump patch 版本。**
- [ ] **Step 2: 全量验收** —— `bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs` 全绿（pre-commit 钩子会重建 dist 并 stage，属预期）。
- [ ] **Step 3: `bun run size`**，记录 root 包 gzip 前后字节数（预期增量 < 2KB；超出则停下查明）。
- [ ] **Step 4: Commit** —— `chore: 版本 0.3.4`。
- [ ] **Step 5: 真浏览器手测（主会话执行，合并前）** —— demo 页面写日志 → 刷新 → `log.list` 仍在 → 点文件名新窗口打开 → hover 出末尾 5 条 tips；Chrome 扩展 SW + side panel 双写同一 DB（spec §六.4）。
- [ ] **Step 6: 交回主会话**——由主会话跑 §13 合并协议（子代理不得执行）。
