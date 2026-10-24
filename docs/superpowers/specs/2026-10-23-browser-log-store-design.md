> **包结构已于 2026-10-24 调整**：下面示例里的包名已按三包结构更新（`@needle/logo` / `@needle/shell`）；包结构以 `2026-10-24-three-packages-design.md` 为准，本文的 IndexedDB 设计仍然有效。

# 浏览器日志落 IndexedDB 设计

日期：2026-10-23
状态：待人类批准

## 一、意图与 why

浏览器（普通页面、Chrome 扩展页面、扩展 Service Worker）里没有文件系统，日志现在只有两个去处：DevTools console 和面板右栏的内存虚拟列表（刷新即失）。用户报障时拿不出证据。

给浏览器端补一个基于 IndexedDB 的日志存储：

- 页面刷新、崩溃、SW 被回收后，日志还在；
- 用户报障时在 Shell 面板里 `log.list` 看到文件列表，点文件名打开全文，手动保存发给我们——**与服务端 `log.list` 的体验完全一致**；
- Chrome 扩展的 SW、side panel、options 等多个上下文共享扩展 origin 的同一个 IndexedDB，日志自然汇总到一处（官方文档明确：extension storage 跨 SW、扩展页面、offscreen documents 共享）。

## 二、目标 / 非目标 / 反目标

**目标**

1. `createIndexedDbStore()`：一个对象，同时是 `Sink`（写）和 `LogFiles`（读），从根入口 `.` 导出（纯 Web API，无 `node:` 依赖）。
2. 浏览器本地模式下 `log.list` 列出 IndexedDB 里的日志文件；点文件名在新窗口打开全文（blob），用户手动保存。
3. `log.list` 的文件名 hover 出现末尾若干行样本提示（tips），服务端与浏览器共用。
4. 保留策略：7 天 + 5000 条上限，写入时顺手清理。
5. IDB 不可用（无痕模式、部分 WebView）时静默降级：写丢弃、`log.list` 返回空，不打扰业务。

**非目标**

- 不做日志自动上传到收集端（`browser-client.md` 现有的 sendBeacon 方案继续有效，两者可并存）。
- 不做 `log.export` 命令（2026-10-23 拍板取消，导出 = `log.list` 点开 + 手动保存）。
- 不做 content script 的日志代写（content script 的 IDB 是宿主页的，不是扩展的；要走 `chrome.runtime.sendMessage` 让 SW 代写，那是另一个 feature）。
- 不做敏感数据脱敏。风险要在 best-practices 文档里写明：日志含业务数据，长期留在用户机器上；扩展的 storage 用户「清除浏览数据」时**不会**被清（官方文档），需产品层面自觉。
- 服务端不自动挂 file sink，浏览器不自动挂 IDB sink——一切 `addSink` 手动接（2026-10-23 拍板）。

**反目标（做出来就算失败）**

- 每条日志开一个事务写 IDB，把主线程 IO 打满。
- 为了「未来可能的查询需求」给 store 加二级索引、查询 DSL。

## 三、约束

- 包约束：`@needle/logo` 不得依赖 `@needle/shell`；两个包的根入口不得 import 任何 `node:`（`packages/*/test/browser-safety.test.ts` 对打包产物做内容断言）。
- `Sink` 契约：一次收一批 `LogRecord[]`（`packages/logo/src/types.ts`），任何 sink 自动攒批受益。
- 浏览器里 logger 默认不攒批（探测不到 stdout，逐条立即写出）；用 IDB sink 的文档示例必须显式 `batch: true` + 建议 `flushIntervalMs: 16`。
- warn/error 立即 flush 并带走积压，是 logger 已有行为，IDB sink 不改变它。
- 代码风格：控制流强制花括号、语句体独占多行、`else` 跟 `}`。
- specs 冲突检查：本设计与 `2026-10-22-logo-design.md` 不冲突——`LogFiles` 端口本来就是「由宿主注入」的设计，浏览器侧此前只是没有实现。

## 四、方案取舍（已讨论定案）

| 决策点 | 选项 | 结论与理由 |
|---|---|---|
| 挂载方式 | Shell 自动挂 store / 手动 `addSink` | **手动**。自动挂覆盖不了 SW（模块实例不跨上下文共享，SW 那份还得手写）；库不该替用户决定往磁盘写东西；与 `createFileSink` 手动挂的先例一致。 |
| 导出入口 | `log.export` 命令 / 复用 `log.list` | **复用 `log.list`**。与服务端同一条命令、同一个交互（点文件名 → 打开 → 手动存），少一条命令、少一种 `CommandOutput` 形态。2026-10-23 用户明确取消 export。 |
| tips 数据来源 | hover 时发请求取尾部 / 列表响应自带 sample | **列表自带**（GONSOLE 同款）。`LogFileEntry` 加 `sample` 字段，`list()` 时就读好；零新端点、零 hover 延迟、服务端浏览器共用。 |
| sample 位置 | 文件头（GONSOLE 实际做法）/ 文件尾 | **文件尾（最新 5 条）**。GONSOLE 读的是头 5 行，但日志排查要看最新的；与用户「最后的 5 条」的原始诉求一致。 |
| 虚拟文件组织 | 单一 web.log / 按级别级联三文件 | **按级别级联**（info.log / warn.log / error.log），与 Node file sink 同构：高级别记录同时进低级别文件。`log.list` 在两端长得一样，心智模型零迁移。 |
| UI 反馈形态 | 新增 `file` 输出类型 / 纯文本 | 不再需要。点开走既有 blob 流程，`CommandOutput` 维持 text/table/json 三种。 |
| debug 级别处理（builder check 后拍板） | 写入丢弃 / 存而不读 / 并入 info.log | **加 `minLevel` 选项（默认 "info"），写入时丢弃低于级别的记录**。与 file sink 完全同构（其 `minLevel` 也是公开选项）；「存而不读」白白吃 5000 条配额，排除。 |
| 过期判定时钟锚（builder check 后拍板） | 记录 time / 入库顺序 | **保留 `time < now - keepDays`**。常规 NTP 校正影响可忽略；灾难级前跳的最坏后果（丢一批旧日志）可接受，写进已知限制。5000 条上限按入库 id 判旧，时钟无关，报障最需要的当前会话日志不受威胁。 |
| read() 字节护栏（builder check 后拍板） | 无上限 / 硬编码上限 | **不加**。内容上界由 5000 条封顶（条数保留是已拍板的决策）；截断会产出解析不了的日志文件，比偶尔的大 blob 更糟。记入已知限制。 |

## 五、已定设计

### 5.1 LogStore：一个对象两个身份

```ts
// packages/logo/src/sinks/idb.ts（暂名），从包根入口 `.` 导出
export interface IndexedDbStoreOptions {
  /** 数据库名。默认 "needle-logs"；多应用同源共存时各自命名。 */
  name?: string;
  /** 保留天数，默认 7。 */
  keepDays?: number;
  /** 记录条数上限，默认 5000。 */
  maxRecords?: number;
  /** 低于这个级别的记录写入时直接丢弃，默认 "info"；开 debug 日志时传 "debug"。 */
  minLevel?: Level;
  /** 注入时间，测试用。 */
  now?: () => number;
}

export type LogStore = Sink & LogFiles & { close(): void };

export function createIndexedDbStore(options?: IndexedDbStoreOptions): LogStore;
```

用户接线（完整，就这两行）：

```ts
import { logo, createIndexedDbStore } from "@needle/logo";
import { createBrowserShell } from "@needle/shell";

const store = createIndexedDbStore();
logo.addSink(store);   // 写：与其它 sink 并列

createBrowserShell({
  element,
  auth: { users: {} },
  user: "local",
  logFiles: store,     // 读：复用既有端口，log.list 自动可用
});
```

`BrowserShellOptions` 与 `ShellSourceOptions` **不改签名**——`logFiles` 已存在于 `ShellSourceOptions`，`createBrowserShell` 已透传。变化的只有本地适配器的 `fetchFile`（见 5.4）。

logger 的 `dispose()` 会调用 sink 的 `close()`（既有机制），store 的 `close()` 关掉 DB 连接。

### 5.2 存储模型

- 数据库：`needle-logs`（**版本 2**）。object store `records`：**out-of-line 自增键**（不传 `keyPath`）、`autoIncrement: true`；索引 `by_time` on `time`。
  - v1 曾用 `keyPath: "id"`，2026-10-23 复审发现 `id` 是最常见的业务字段，记录里的 `id` 会变成主键——同一订单 id 的两条日志互相覆盖、静默丢日志。v2 升级时删掉旧 store 重建（日志是易失数据，不写迁移）。
- 记录存**原始 `LogRecord` 对象**（已是 JSON-safe，见 `packages/logo/src/types.ts` 的记录契约），序列化成文本只在 `read` / sample 时做。
- **写**：低于 `minLevel`（默认 "info"）的记录写入时丢弃——与 file sink 一致：低于级别的记录不落任何文件。其余收进单个 `readwrite` 事务连续 `put`、一次 commit。绝不逐条开事务。
- **级联虚拟文件**：`info.log` / `warn.log` / `error.log`，语义与 file sink 一致——`warn.log` 含 warn+error，`error.log` 只含 error。写时不分桶（IDB 是一份流），读时按级别过滤。
- **`list()`**：固定返回三个 entry（级别达到默认 `minLevel: "info"` 才出现，与 file sink「按需建文件」对齐：一条 error 都没有时不冒出空的 error.log——某级别 0 条记录时不列它）。`modified` = 该级别最新记录的 `time`；`size` = 该级别所有行文本长度之和 + 每行换行（字符数，展示用，不做字节精确换算）。
- **`read(name)`**：名字必须是 `info.log` / `warn.log` / `error.log` 之一（同样的白名单思路），按级别过滤 + `formatLine`（`时间 [I] JSON`，与文件 sink 落盘格式一致）拼接。
- **保留策略**：写批次的同一事务里顺手清——`count > maxRecords` 按入库 id 删最旧；`time < now - keepDays` 删过期。多上下文并发写时清理可能略微多删/少删，可接受，不做跨上下文协调。

### 5.3 sample（tips）

- `LogFileEntry`（`packages/logo/src/types.ts`）加字段 `sample?: string`：该文件**末尾 5 行**，每行截 200 字符，`\n` 分隔，纯文本。可选字段，不强迫简单实现。
- Node 侧 `createLogFiles`（`packages/logo/src/log-files.ts`）：`list()` 时对每个文件读尾部——open 后从 `size - 4KB` 读到末尾，按 `\n` 拆，丢弃窗口开头可能截断的半行，取最后 5 条完整行。读失败静默，sample 缺省。
- 浏览器侧：`list()` 一次 `getAll()` 在 JS 里分桶后取该级别最后 5 条（`by_time` 索引只给 `prune` 用，读路径不做索引扫描），`formatLine` 后按 200 字符截断。
- UI：`LinkedCell`（`packages/shell/src/types.ts`）加 `tip?: string`；表格单元格渲染（`packages/shell/src/ui/table.ts`）把带 tip 的链接包进 hover 容器，纯 CSS 显示（`visibility` 切换 + `white-space: pre-wrap`），样本用 `textContent` 渲染——**不得用 innerHTML**（GONSOLE 修过的 XSS：日志内容里的 `<script>` 会被执行）。CSS 进 `packages/shell/src/ui/style.ts`，Solarized 变量取色。
- `log.list` 组表格时把 `entry.sample` 填进 `tip`。服务端与浏览器自动同享。

### 5.4 本地适配器读日志

`createLocalAdapter`（`packages/shell/src/ui/local.ts`）的 `fetchFile(href)`：现在无条件返回失败文案。改为——href 匹配 `/log/<name>`（与 `log.list` 生成的链接 `${basePath}/log/${name}` 同口径）时，调 `source.logFiles.read(name)`：读到返回 `{ ok: true, text }`，读不到返回 `{ ok: false, error: "日志不存在" }`；其余 href 维持失败。打开新窗口的 blob 流程在 `view.ts` 已有，不动。

### 5.5 Service Worker 与多上下文

- SW 里 IDB 可用（官方文档），与扩展页面共享同一份数据。SW 的 logger 同样 `addSink(store)` 即可，无需共享模块实例。
- SW 平均 30 秒被回收：攒批中未提交的记录可能丢最后几十毫秒。warn/error 立即 flush（既有行为），可接受；best-practices 文档写明。
- `indexedDB` 全局在 SW 缺失或打开失败时：写路径丢弃、`list()` 返回 `[]`、`read()` 返回 `null`，不抛错；store 自带 `reportOnce` 在 open 失败 / 升级被挡 / 读失败时打一条 `console.error`（`logo.ts` 的 `reportSinkError` 只兜 sink 抛错，这里 store 从不抛，所以不靠它）。

### 5.6 已知限制（写进 best-practices）

- 页面崩溃瞬间最后 ~100ms（一个攒批窗口）的日志可能未提交。
- IDB 写入异步，`sendBeacon` 方案仍是「发送到远端」的唯一可靠出口；IDB 方案解决的是「本机留存」。
- 时钟大幅前跳（NTP 大幅校正、VM 快照恢复）会让 keepDays 清理成批删掉近几天的日志，接受；5000 条上限那根轴按入库 id 清理，不受时钟影响。
- `read()` 无字节护栏：单文件文本量上界 = 5000 条记录 formatLine 的总和；刻意不截断——截断会产出解析不了的日志文件。
- 敏感数据留存风险（见非目标）。

## 六、验收口径

1. `bun run build && bunx tsc --noEmit && bun test && node test/smoke/node.mjs` 全绿（验收命令，`docs/01.memory.md`）。
2. 单测：store 的 put/级联过滤/保留清理/sample 截断/降级（fake IDB 或 miniflare 提供的实现，builder 定）；`createLogFiles` 尾部读取；`LinkedCell.tip` 渲染（textContent 断言含 `<script>` 原样）；本地 `fetchFile` 拦截 `/log/:name`。
3. `browser-safety` 测试继续绿（store 在根入口导出后自动被覆盖）。
4. 真浏览器手测（写进 plan 的验收步骤）：页面写日志 → 刷新 → `log.list` 仍在 → 点文件名新窗口打开 → hover 出末尾 5 条 tips；Chrome 扩展 SW + side panel 双写同一 DB。
5. `bun run size` 复现，记录 root bundle 增量（预期 < 2KB gzip；超了回来说明）。

## 七、留给 builder 的决定

- `packages/logo/src/sinks/idb.ts` 的内部结构（打开/升级/清理的函数划分）、测试如何 fake IDB。
- `list()` 的 size 估算实现。
- 尾部读取窗口（Node 4KB、浏览器 5 条）的常量命名与注释（magic number 要注释为什么）。
- CSS 类名沿用 GONSOLE 的 `tips`/`tips_text` 还是对齐本库现有命名。
- 文档落点：`docs/best-practices/browser-client.md`、`chrome-extension.md` 各加一节「日志落本机」；README 的日志节如需一句话提及。
- 版本号 +1 patch 随合并流程（AGENTS.md §14）。
