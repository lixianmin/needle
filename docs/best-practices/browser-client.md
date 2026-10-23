# 浏览器纯前端页

Vite / 静态站，没有后端，用户在 Windows 上的 Chrome / Edge 里打开。这里既能写日志，也能挂 DOM 面板，只是**没有落盘、没有鉴权、没有第二个进程**。

## 1. 接线

```ts
import { logo } from "@needle/logo";
import { createBrowserConsole } from "@needle/logo/console";

const panel = createBrowserConsole({
  logger: logo,
  title: "my-app",
  version: import.meta.env.VITE_APP_VERSION,   // 版本号单一来源，见下方 §5
  auth: { users: {} },                         // 浏览器里没有鉴权意义
  user: "local",                                // 能打开页面的人就是这个人
  element: document.getElementById("console")!,
});
```

`auth` 仍然必传，但 `users` 留空 + `user` 非空就是本地模式：不签发 token，所有命令直接可跑，`/events` 那套 HTTP 路径根本不参与。看不到面板就等于看不到这些数据，多一层口令只是仪式。

## 2. 生产环境默认别渲染面板

面板里是内部日志和越权命令（能读到内存里的 token、整个 store 快照）。默认藏起来，用 URL 参数或构建期常量打开：

```ts
const enabled = new URLSearchParams(location.search).has("debug")
  || import.meta.env.DEV;

if (enabled) {
  const host = document.createElement("div");
  host.id = "console";
  document.body.append(host);
  const panel = createBrowserConsole({ /* … */ element: host });
  // 关掉时记得 dispose()，别只把节点 display:none
  (window as any).__closeConsole = () => panel.dispose();
}
```

用户报障时让他加 `?debug` 截个图，比让他开 DevTools 翻 console 高效——面板里的 `log.list`、`top` 在纯前端页里同样能用（只是没有文件可读）。

## 3. 日志落点

浏览器里没有 `node:fs`，`createFileSink` 用不了（`@needle/logo/node` 顶层 import 了 `node:fs`，打包会直接失败）。三条替代路：

- **开发期**：默认 stdout sink 退化成 `console.log`，输出格式仍是一行 `2026-10-23T10:50:43 [I] {…}`，`info` 逐条立即写出（探测不到 `process.stdout`，批量自动关闭）。
- **现场排障**：DOM 面板实时滚动，保留最近 500 行。
- **事后**：自定义 sink 攒一批 `fetch` / `navigator.sendBeacon` 发给自己的收集端。页面要关时 `sendBeacon` 是唯一可靠出口。

```ts
import type { Sink } from "@needle/logo";

const buffer: string[] = [];
const upload: Sink = (batch) => {
  for (const record of batch) buffer.push(JSON.stringify(record));
  if (buffer.length >= 50) void flush();      // 50 条一批：页面崩溃前也大概率已经发出去了
};
logo.addSink(upload);

addEventListener("pagehide", () => {
  navigator.sendBeacon("/log", buffer.join("\n"));
  logo.dispose();                              // 先 flush 再关 sink
});
```

## 4. 客户端专用设置

| 需求 | 做法 |
|---|---|
| 更细的刷新节奏 | `newLogger({ flushIntervalMs: 16 })`（按帧）；默认 100ms 对页面也够 |
| 减少栈开销 | `newLogger({ stackLevel: "off" })` 或 `"error"`：`warn` 默认为每条构造一次 `Error` |
| 只发错误 | `logo.setLevel("warn")` + 只挂上报 sink |
| 稳定标识 | `newLogger({ name: "web" })` 或在 `child({ session })` 里带一次会话 id |

默认 `level` 是 `info`：`debug` 要 `setLevel("debug")` 才出来。

## 5. 坑

- **版本号只有一处来源。** 用构建期注入（Vite 的 `define` / `import.meta.env`）从 `package.json` 读，别在页面里再写一个常量——面板头栏显示的版本必须等于当前跑的代码。
- **`localStorage` 可能直接抛错。** 命令历史（`logo.console.history`，50 条）和面板内输入历史写入失败会被静默忽略：隐私模式、部分嵌入式 WebView 都这样。功能不该依赖它。
- **`dispose()` 不是可选的。** 面板的定时器与 broadcast 订阅跟着页面一起走；SPA 里切换路由后重建控制台，不 dispose 就多一份订阅，日志重复渲染。
- **别把日志打进 `innerHTML`。** 面板内部只用 `createElement` + `textContent`；自己的业务代码也别把 `msg` 拼进 HTML，日志里可能是用户输入。
- **体积。** `@needle/logo` 2.7 KB、含控制台 13.7 KB（min+gzip，`bun run size` 可复现）。控制台只在 `enabled` 分支里 `import()` 动态加载，首屏可以只要 2.7 KB。
