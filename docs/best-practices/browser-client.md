# 浏览器纯前端页

Vite / 静态站，没有后端，用户在 Windows 上的 Chrome / Edge 里打开。控制台和日志都能用，只是**没有落盘、没有鉴权、也没有第二个进程**——一切都活在这个标签页里。

只做日志 2.7 KB、带面板 13.7 KB（min+gzip）；面板可以动态 `import()`，首屏只要前一半。

## 控制台

### 接线

```ts
import { createBrowserShell, logo } from "@needle/logo";

const panel = createBrowserShell({
  logger: logo,
  title: "my-app",
  version: import.meta.env.VITE_APP_VERSION,
  auth: { users: {} },       // 浏览器里没有鉴权意义
  user: "local",             // 能打开页面的人就是这个人
  element: document.getElementById("shell")!,
});
```

`auth` 仍然必传，但 `users` 留空加 `user` 非空就是本地模式：不签发 token、不发 `/events`，所有命令直接可跑。看不到面板就等于看不到这些数据，再要一次口令只是仪式。

### 生产环境默认不渲染

面板里有内部日志和能读内存的命令。默认藏起来，用 URL 参数或构建期常量打开；关掉时 `dispose()`，别只把节点 `display:none`：

```ts
const enabled = new URLSearchParams(location.search).has("debug") || import.meta.env.DEV;

if (enabled) {
  const host = document.createElement("div");
  document.body.append(host);
  createBrowserShell({ /* 同上 */ element: host });
}
```

用户报障时让他加 `?debug` 截个图，比让他开 DevTools 翻 console 高效。

## 日志

### 初始化

默认实例直接可用：逐条写 `console.log`，格式仍是一行 `2026-10-23T10:50:43 [I] {…}`。

```ts
import { logo } from "@needle/logo";

logo.info("checkout failed", { sku: 42 });
```

要改名字、级别或攒批，就自己建一个，并把它传给面板：

```ts
import { newLogger } from "@needle/logo";

const log = newLogger({
  name: "web",
  level: "info",
  stackLevel: "error",        // 默认 warn：每条 warn 都要造一次 Error，页面上能省则省
  batch: true,                // 页面里定时器可靠，可以攒一帧再写 console
  flushIntervalMs: 16,
});
```

页面里默认**不攒批**（库探测不到可同步写的 stdout，和 Workers 一样逐条立即写出），所以想要批量必须显式 `batch: true`。

### 没有文件 sink

浏览器里没有 `node:fs`，`@needle/logo/node` 打包会直接失败。要事后查，就自己挂一个 sink 往收集端发；页面正在关闭时，`sendBeacon` 是唯一可靠的出口：

```ts
import type { Sink } from "@needle/logo";

const queue: string[] = [];

const ship = async (): Promise<void> => {
  const body = queue.splice(0).join("\n");   // 先摘出来再发：发送期间新来的日志不会丢
  if (body !== "") await fetch("/log", { method: "POST", body });
};

const upload: Sink = (batch) => {
  for (const record of batch) queue.push(JSON.stringify(record));
  if (queue.length >= 50) void ship();       // 50 条一批，页面崩溃前也大概率已经发出去了
};
log.addSink(upload);

addEventListener("pagehide", () => {
  const body = queue.splice(0).join("\n");
  if (body !== "") navigator.sendBeacon("/log", body);
  log.dispose();                             // 先 flush 再关 sink
});
```

面板只显示命令输出与订阅主题，不显示日志；日志看 DevTools 的 console（默认 sink 就是写它）。

### 坑

- **版本号只有一处来源。** 用构建期注入（Vite 的 `define` / `import.meta.env`）从 `package.json` 读；面板头栏显示的版本必须等于当前跑的代码。
- **`localStorage` 可能直接抛错。** 命令历史（`logo.shell.history`，50 条）在隐私模式、部分嵌入式 WebView 里写不进去，失败会被静默忽略。功能不该依赖它。
- **`dispose()` 不是可选的。** 面板的定时器与订阅跟着页面走；SPA 切换路由后重建控制台，不 dispose 就多一份订阅，日志重复渲染。
- **别把日志拼进 `innerHTML`。** 面板内部只用 `createElement` + `textContent`；业务代码也别把 `msg` 拼进 HTML，那里面可能是用户输入。
