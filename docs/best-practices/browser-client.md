# 浏览器纯前端页

Vite / 静态站，没有后端，用户在 Windows 上的 Chrome / Edge 里打开。日志能写，面板能挂，只是**没有落盘、没有鉴权、也没有第二个进程**——一切都活在这个标签页里。

只做日志 2.7 KB、带面板 13.7 KB（min+gzip）。面板可以在 `enabled` 分支里动态 `import()`，首屏只要前一半。

## 接线

```ts
import { logo } from "@needle/logo";
import { createBrowserConsole } from "@needle/logo/console";

const panel = createBrowserConsole({
  logger: logo,
  title: "my-app",
  version: import.meta.env.VITE_APP_VERSION,
  auth: { users: {} },       // 浏览器里没有鉴权意义
  user: "local",             // 能打开页面的人就是这个人
  element: document.getElementById("console")!,
});
```

`auth` 仍然必传，但 `users` 留空加 `user` 非空就是本地模式：不签发 token、不发 `/events`，所有命令直接可跑。看不到面板就等于看不到这些数据，再要一次口令只是仪式。

## 生产环境默认不渲染

面板里有内部日志和能读内存的命令。默认藏起来，用 URL 参数或构建期常量打开；关掉时 `dispose()`，别只把节点 `display:none`：

```ts
const enabled = new URLSearchParams(location.search).has("debug") || import.meta.env.DEV;

if (enabled) {
  const host = document.createElement("div");
  document.body.append(host);
  createBrowserConsole({ /* 同上 */ element: host });
}
```

用户报障时让他加 `?debug` 截个图，比让他开 DevTools 翻 console 高效。

## 日志落点

浏览器里没有 `node:fs`，`@needle/logo/node` 打包会直接失败。三条替代路：

- **开发期**：默认 stdout sink 退化成 `console.log`，格式仍是一行 `2026-10-23T10:50:43 [I] {…}`；探测不到 `process.stdout` 时批量自动关闭，逐条立即写出。
- **现场排障**：DOM 面板实时滚动，保留最近 500 行。
- **事后**：自定义 sink 攒一批 `fetch` 或 `navigator.sendBeacon` 发给自己的收集端。页面正在关闭时，`sendBeacon` 是唯一可靠的出口。

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
logo.addSink(upload);

addEventListener("pagehide", () => {
  const body = queue.splice(0).join("\n");
  if (body !== "") navigator.sendBeacon("/log", body);
  logo.dispose();                            // 先 flush 再关 sink
});
```

## 客户端设置

| 需求 | 做法 |
|---|---|
| 更细的刷新节奏 | `newLogger({ flushIntervalMs: 16 })`（按帧）；默认 100ms 对页面也够 |
| 减少栈开销 | `newLogger({ stackLevel: "off" })` 或 `"error"`：`warn` 默认给每条造一个 `Error` |
| 只发错误 | `logo.setLevel("warn")`，上报 sink 只收 `warn` / `error` |
| 稳定标识 | `newLogger({ name: "web" })`，或在 `child({ session })` 里带一次会话 id |

默认 `level` 是 `info`，`debug` 要 `setLevel("debug")` 才出来。

## 坑

- **版本号只有一处来源。** 用构建期注入（Vite 的 `define` / `import.meta.env`）从 `package.json` 读，别在页面里再写一个常量——面板头栏显示的版本必须等于当前跑的代码。
- **`localStorage` 可能直接抛错。** 命令历史（`logo.console.history`，50 条）在隐私模式、部分嵌入式 WebView 里写不进去，失败会被静默忽略。功能不该依赖它。
- **`dispose()` 不是可选的。** 面板的定时器与订阅跟着页面走；SPA 切换路由后重建控制台，不 dispose 就多一份订阅，日志重复渲染。
- **别把日志拼进 `innerHTML`。** 面板内部只用 `createElement` + `textContent`；业务代码也别把 `msg` 拼进 HTML，那里面可能是用户输入。
