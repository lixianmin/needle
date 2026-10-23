# Chrome 扩展

能用。扩展自己的页面里可以挂一块 DOM 面板：命令在你自己的扩展代码里执行，日志进该页面的 DevTools。也可以让面板连另一台机器上的控制台，那边的命令在远端跑。

## 术语

Chrome 扩展的代码跑在几个互不相同的上下文里，先把名字对上：

| 术语 | 是什么 |
|---|---|
| manifest v3（MV3） | 扩展清单的格式版本，Chrome 商店现在只收 v3 |
| 扩展页面 | 扩展自己的 HTML 页面：side panel（浏览器侧边栏）、devtools（开发者工具里的面板）、options（扩展设置页） |
| service worker | 扩展的后台脚本，没有界面，空闲约 30 秒会被回收 |
| content script | 注入到普通网页里跑的脚本，和宿主页共用一个 DOM |
| popup | 点扩展图标弹出的小窗，一失焦就销毁 |

| 用法 | 入口 | 命令在哪跑 | 日志去哪 |
|---|---|---|---|
| 扩展页面挂本地面板 | `createBrowserShell({ element })` | 你的扩展代码里，进程内直调 | 该页面的 DevTools |
| 扩展页面连远程控制台 | `mountShell(el, createFetchAdapter({ basePath }))` | 远端那台服务器 | 远端的 sink（文件、飞书） |

扩展里没有文件系统，所以两种用法都没有 `log.list`（它读的是磁盘目录）。

## 一、挂本地面板

`createBrowserShell` 要一个 `HTMLElement`，只能在有 `document` 的扩展页面用。

```ts
// sidepanel.ts
import { createBrowserShell } from "@needle/needle/shell";

const panel = createBrowserShell({
  element: document.getElementById("shell")!,
  title: "my-extension",
  version: chrome.runtime.getManifest().version,
  auth: { users: {} },   // 扩展里没有鉴权意义
  user: "local",         // 能打开面板的人本来就能看到这些数据
});
```

`manifest.json` 里 side panel 只要一行：

```jsonc
{ "side_panel": { "default_path": "sidepanel.html" } }
```

### 面板放哪

| 位置 | 能挂面板吗 | 原因 |
|---|---|---|
| 扩展页面（side panel / devtools / options） | 能 | 有 `document` |
| service worker | 不能 | 没有 `document`——它只写日志，见第三节 |
| content script（注入宿主页） | 不推荐 | 宿主页 CSP 会砍样式，日志进宿主页 DOM |

popup 别用——popup 一失焦就销毁，面板和历史一起没了。

### 扩展页面的 CSP 挡不住它

扩展页面的默认 CSP 只限制 `script-src` 与 `object-src`（manifest v3 起收紧的）。面板 UI 全程 `document.createElement`，样式是往 `head` 塞一个 `<style>` 元素，没有内联 `onclick`、没有 `eval`、没有远程脚本，所以 side panel / devtools / options 直接能用。

反过来说：**不要为了挂面板去改 `content_security_policy`**。真要放宽，说明代码里用了 `eval` 或内联脚本，那是修代码。

### 别塞进宿主页面

content script 拿得到宿主页的 `document`，但两件事会咬人：

- 宿主页的 CSP 可能砍掉注入的 `<style>`，面板变成裸 HTML。
- 日志和命令结果会进用户可见、可滚动的 DOM，也会被宿主页的脚本读到。

要面板就在扩展自己的页面里开；要在宿主页做小提示，自己画一个。

## 二、连远程服务端

面板也可以连另一台机器上的控制台，这时换 fetch 适配器，鉴权重新有意义：

```ts
import { createFetchAdapter, mountShell } from "@needle/needle/shell";

const view = mountShell(
  document.getElementById("shell")!,
  createFetchAdapter({ basePath: "https://order-service.example.com/shell", topics: "top:5000" }),
);
```

- `manifest.json` 要给这个源 `host_permissions`，否则跨域请求被拦。
- token 存在 `localStorage` 的 `logo.shell.token`，随 `Authorization` 头发出去（不用 `EventSource`，正是因为它带不了头）。
- `log.list` 的链接是服务端按自己的 `basePath` 生成的相对路径，跨域点开会 404；远程面板适合敲命令、看订阅主题。

## 三、日志

扩展里没有文件系统：`createFileSink` 不可用，`log.list` 没有目录可读。日志去该页面的 DevTools。

service worker 里没有 `window` / `document`，`localStorage` 也不可用（要 `chrome.storage`），空闲约 30 秒会被终止。所以 SW 里只写日志，不挂常驻 UI：默认 stdout sink 退化成 `console.log`，在 `chrome://extensions` → 你的扩展 → Service Worker → 检查视图里看。

要留证据就自己挂 sink，只落 `warn` / `error`——扩展里没有批量，逐条写 storage 会把日志变成 IO 瓶颈：

```ts
import type { LogRecord, Sink } from "@needle/needle";

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

## 四、坑

- **`info` 不攒批。** 批量刷新依赖能同步写 stdout，扩展里探测不到（没有 `process.stdout`），库自动改成逐条立即写出，「等 100ms 再看 console」在这里不成立。
- **面板要显式 `dispose()`。** 用户关掉时挂到 `unload`，否则订阅和定时器跟着页面一起泄漏。
- **命令历史存 `localStorage`，写不进去会被静默忽略。** 隐私模式、沙箱页面都可能抛错，功能不该依赖它。
- **`version` 从 `chrome.runtime.getManifest()` 读。** 版本只在 `manifest.json` 一处维护。
- **打包后没有 `process`。** 构建期常量别写成 `process.env.X`，运行时会抛 `process is not defined`。
