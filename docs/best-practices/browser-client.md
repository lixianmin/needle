# 浏览器纯前端页

Vite / 静态站，没有后端：**没有落盘、没有鉴权、也没有第二个进程**，一切都活在这个标签页里。只做日志 1.6 KB、带面板 20.4 KB（min+gzip，`bun run size` 可复现）。

## 一、面板

```ts
import { createBrowserShell } from "@needle/needle/shell";

const panel = createBrowserShell({
  element: document.getElementById("shell")!,
  title: "my-app",
  version: import.meta.env.VITE_APP_VERSION,
  auth: { users: {} },   // 浏览器里没有鉴权意义
  user: "local",         // 能打开页面的人就是这个人
});
```

`auth` 仍必传，但 `users` 留空加 `user` 非空就是本地模式：不签发 token、不发 `/events`，所有命令直接可跑。

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

## 二、日志

页面里默认**不攒批**（库探测不到可同步写的 stdout，和 Workers 一样逐条立即写出），要批量必须显式打开：

```ts
import { newLogger } from "@needle/needle";

const log = newLogger({
  name: "web",
  level: "info",
  stackLevel: "error",   // 默认值，和 Go 版一致：只有 error 才抓栈
  batch: true,           // 页面里定时器可靠，可以攒一帧再写 console
  flushIntervalMs: 16,
});
```

没有 `node:fs`：`@needle/needle/node` 里全是 Node 专属 API，浏览器打包会把它换成空实现，别在浏览器代码里 import 它。要事后查就自己挂 sink 往收集端发；页面正在关闭时 `sendBeacon` 是唯一可靠的出口：

```ts
import type { Sink } from "@needle/needle";

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

## 三、坑

- **版本号只有一处来源。** 用构建期注入（Vite 的 `define` / `import.meta.env`）从 `package.json` 读；头栏显示的版本必须等于当前跑的代码。
- **`localStorage` 可能直接抛错。** 命令历史（`logo.shell.history`，50 条）在隐私模式、部分嵌入式 WebView 里写不进去，失败会被静默忽略。
- **`dispose()` 不是可选的。** 面板的定时器与订阅跟着页面走；SPA 切换路由后重建控制台，不 dispose 就多一份订阅，日志重复渲染。
- **别把日志拼进 `innerHTML`。** 面板内部只用 `createElement` + `textContent`；业务代码也别把 `msg` 拼进 HTML，那里面可能是用户输入。
