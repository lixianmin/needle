# Chrome 扩展（MV3）

扩展里没有服务器，也没有文件系统。代码只能待在三块地方，面板放哪、日志去哪由这块决定：

| 位置 | 有 DOM | 日志去哪 | 能放面板 |
|---|---|---|---|
| service worker | 无 | `console` → `chrome://extensions` 的检查视图 | 不能（没有 `document`） |
| 扩展页面（side panel / popup / options / devtools） | 有 | `console` + DOM 面板 | 能 |
| content script（注入宿主页面） | 有（宿主页） | 宿主的 console + 扩展自己的 console | 不推荐，见下文 |

没有文件 sink：`@needle/logo/node` 顶层 `import "node:fs"`，扩展里 import 它会在打包或运行时报错。

## service worker：只写日志

```ts
import { logo } from "@needle/logo";

logo.info("extension installed", { id: chrome.runtime.id });
logo.error("fetch failed", err, { url });
```

SW 没有 `window` / `document`，`localStorage` 也不可用（要用 `chrome.storage`）；空闲约 30 秒就可能被终止，下一次事件再把脚本拉起来。所以这里只写日志，不放常驻 UI。

输出走 `console.log`，格式仍是那一行 `2026-10-23T10:50:43 [I] {…}`。看它的地方是 `chrome://extensions` → 你的扩展 → Service Worker → 检查视图。

要留证据（用户那边出过一次错，想事后看）就挂一个 sink 到 `chrome.storage.local`。只落 `warn` / `error`：浏览器里没有批量，逐条写 storage 会把日志变成 IO 瓶颈。

```ts
import type { LogRecord, Sink } from "@needle/logo";

const kept: LogRecord[] = [];
const persist: Sink = (batch) => {
  const worth = batch.filter((record) => record.level === "warn" || record.level === "error");
  if (worth.length === 0) return;
  kept.push(...worth);
  if (kept.length > 200) kept.splice(0, kept.length - 200);   // 200 条够定位一次故障
  void chrome.storage.local.set({ recentIssues: kept });
};
logo.addSink(persist);
```

## 扩展页面：面板挂这儿

`createBrowserConsole` 要一个 `HTMLElement`，只能在有 `document` 的扩展页面用。选 side panel 或 devtools 面板，别用 popup——popup 一失焦就销毁，面板和历史一起没了。

```ts
// sidepanel.ts
import { logo } from "@needle/logo";
import { createBrowserConsole } from "@needle/logo/console";

const panel = createBrowserConsole({
  logger: logo,
  title: "my-extension",
  version: chrome.runtime.getManifest().version,
  auth: { users: {} },       // 扩展页面没有鉴权意义
  user: "local",             // 能打开这个面板的人，本来就能看到这些数据
  element: document.getElementById("console")!,
});
```

`manifest.json` 里 side panel 只要一行：

```jsonc
{ "side_panel": { "default_path": "sidepanel.html" } }
```

`user` 设成非空就是本地模式：不签发 token、不发 `/events`，所有命令直接可跑。在扩展里，能看到面板就等于能看到这些数据，再要一次口令只是仪式。

## 面板连远程控制台

要连的不是本进程，而是另一个服务端托管的控制台（比如开发机上的调试服务），就换 fetch 适配器：

```ts
import { createFetchAdapter, mountConsole } from "@needle/logo/console";

const view = mountConsole(
  document.getElementById("console")!,
  createFetchAdapter({ basePath: "https://order-service.example.com/console", topics: "top:5000" }),
);
```

- `manifest.json` 里要给这个源 `host_permissions`，否则扩展页面的跨域请求会被拦。
- 这时 `auth ops` 有意义了：token 走 `Authorization` 头（不用 `EventSource`，正是因为它带不了头），存在 `localStorage` 的 `logo.console.token`。
- `log.list` 的链接是服务端按自己的 `basePath` 生成的相对路径，跨域点开会 404；远程面板适合看实时日志和敲命令。

## MV3 的 CSP 挡不住它

MV3 扩展页面默认 CSP 只限制 `script-src` 与 `object-src`，禁止内联脚本和 `eval`。控制台 UI 全程 `document.createElement`，样式是往 `head` 里塞一个 `<style>` 元素，没有内联 `onclick`、没有 `new Function`、没有远程脚本。所以 popup / side panel / devtools / options 直接能用。

反过来说：**不要为了挂面板去改 `content_security_policy`**。真要放宽，说明代码里用了 `eval` 或内联脚本，那是修代码，不是改清单。

## 别把面板塞进宿主页面

content script 拿得到宿主页的 `document`，看起来能挂，但两件事会咬人：

- 宿主页的 CSP 可能砍掉注入的 `<style>`，面板变成一堆裸 HTML。
- 日志和命令结果会进用户可见、可滚动的 DOM，也会被宿主页的脚本读到。

要面板就在扩展自己的页面里开。要在宿主页上做小提示，自己画一个，别把整个控制台搬过去。

## 坑

- **`info` 不会攒批。** 批量刷新依赖能同步写 stdout，扩展里探测不到（没有 `process.stdout`），库自动改成逐条立即写出。所以「等 100ms 再看 console」在扩展里不成立。
- **面板要显式 `dispose()`。** side panel 被关掉时把 `panel.dispose()` 挂到 `unload`，否则订阅和定时器跟着页面一起泄漏。
- **命令历史存在 `localStorage`，写入失败会被静默忽略。** 隐私模式、沙箱页面都可能抛错，功能不该依赖它。
- **`version` 从 `chrome.runtime.getManifest()` 读。** 扩展版本只在 `manifest.json` 一处维护，别在代码里再硬编码一份。
- **打包后没有 `process`。** 只在构建期注入的常量（上报地址之类）别写 `process.env.X`，扩展运行时会抛 `process is not defined`。
