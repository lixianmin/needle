# Chrome 扩展（MV3）

扩展里没有服务器，也没有文件系统。三块地方能放代码，能不能挂面板、日志去哪，各不相同：

| 位置 | 有 DOM | 日志去哪 | 能挂控制台 |
|---|---|---|---|
| service worker | 无 | `console` → `chrome://extensions` 的「检查视图」 | 不能（没有 `document`） |
| 扩展页面（side panel / popup / options / devtools） | 有 | `console` + DOM 面板 | 能 |
| content script（注入宿主页面） | 有（宿主页） | 宿主的 console + 扩展自己的 console | 不推荐，见 §4 |

## 1. service worker 里只写日志，不挂面板

SW 没有 `window`、没有 `document`，`localStorage` 也不可用（用 `chrome.storage`）。空闲约 30 秒就可能被终止，下次事件再把脚本拉起来——所以这里只做日志，不做长驻 UI。

```ts
import { logo } from "@needle/logo";

logo.info("extension installed", { id: chrome.runtime.id });
logo.error("fetch failed", err, { url });
```

默认 stdout sink 在这里退化成 `console.log`，输出的还是那一行 `2026-10-23T10:50:43 [I] {…}`。看它的地方是 `chrome://extensions` → 你的扩展 → Service Worker → 检查视图。

需要留证据（用户环境里出过一次错、想事后看）就加一个自定义 sink 往 `chrome.storage.local` 或自己的上报接口写，别指望文件：

```ts
import type { Sink } from "@needle/logo";

const ring: string[] = [];
logo.addSink((batch) => {
  for (const record of batch) ring.push(JSON.stringify(record));
  if (ring.length > 500) ring.splice(0, ring.length - 500);   // 500 条足够定位一次故障
  void chrome.storage.local.set({ recentLogs: ring.slice(-200) });
});
```

## 2. 面板挂在扩展页面里

`createBrowserConsole` 要一个 `HTMLElement`，所以只能在有 `document` 的扩展页面用。用 side panel 或 devtools 面板，别用 popup——popup 一失焦就销毁，面板和历史一起没了。

```ts
// sidepanel.ts
import { logo } from "@needle/logo";
import { createBrowserConsole } from "@needle/logo/console";

const panel = createBrowserConsole({
  logger: logo,
  title: "my-extension",
  version: chrome.runtime.getManifest().version,
  auth: { users: {} },       // 扩展页面没有鉴权意义
  user: "local",             // 能在扩展里打开面板的人，本来就能看到这些数据
  element: document.getElementById("console")!,
});
```

`manifest.json` 里 side panel 只要一行：

```jsonc
{ "side_panel": { "default_path": "sidepanel.html" } }
```

popup 里要放的话同一份代码即可，接受「关掉就没了」。

登录这件事在扩展里没有意义：`user` 设成非空就是本地模式，所有命令直接可跑，不发 token、不连 `/events`。

## 3. MV3 的 CSP 挡不住这个面板

MV3 扩展页面默认 `script-src 'self'`，禁止内联脚本和 `eval`。控制台 UI 全程 `document.createElement`，样式是往 `head` 里塞一个 `<style>` 元素（`style-src` 不受默认 CSP 限制），没有任何内联 `onclick`、没有 `new Function`、没有远程脚本。所以 popup / side panel / devtools / options 直接能用，不需要放宽 CSP。

反过来说：**不要为了挂面板去改 `content_security_policy`**。放宽了说明代码里用了 `eval` 或内联脚本，那是要修代码，不是要改清单。

## 4. 别把面板塞进宿主页面

content script 能拿到宿主页的 `document`，看起来能挂，但两件事会咬你：

- 宿主页的 CSP 可能砍掉注入的 `<style>`，面板变成一堆裸 HTML。
- 日志和命令结果会进用户可见、可滚动的 DOM，还会被宿主页的脚本读到。

要面板就在扩展自己的页面里开。要在宿主页上做小的状态提示，自己画一个，别把整个控制台搬过去。

## 5. 日志落点

三条路，按需要选：

- **开发期**：默认 stdout sink 走 `console.log`，看 service worker / 页面各自的 DevTools。
- **排障期**：`createBrowserConsole` 的 DOM 面板，实时滚动，命令能读扩展内部状态（`chrome.storage`、当前标签页、token 有效期）。
- **事后**：自定义 sink 写 `chrome.storage.local`（容量有限，只留最近 N 条）或 `fetch` 上报。

没有文件 sink：`@needle/logo/node` 顶层 `import "node:fs"`，扩展里 import 它会在打包或运行时报错。

## 6. 扩展里的坑

- **`info` 不会攒批。** 批量刷新依赖能同步写 stdout，扩展里探测不到（没有 `process.stdout`），库自动改成逐条立即写出。所以「等 100ms 再看 console」这套在扩展里不成立。
- **面板块要显式 `dispose()`。** side panel 被用户关掉时把 `panel.dispose()` 挂到 `unload`，否则订阅和定时器跟着页面一起泄漏。
- **`localStorage` 在扩展页面可用，在 SW 里抛错。** 命令历史存在 `localStorage`（key `logo.console.history`，留 50 条），隐私模式或沙箱环境写入失败会被静默忽略，不影响面板功能。
- **`version` 从 `chrome.runtime.getManifest()` 读。** 扩展版本只在 `manifest.json` 一处维护，别在代码里再硬编码一份。
- **打包后 `process.env` 可能不存在。** 只在构建期注入的常量（如上报地址）别写 `process.env.X`，扩展运行时会抛 `process is not defined`。
