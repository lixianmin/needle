# 浏览器纯前端页

Vite / 静态站，没有后端：**没有落盘、没有鉴权、也没有第二个进程**，一切都活在这个标签页里。只做日志 1.8 KB、带面板 24.9 KB（min+gzip，`bun run size` 可复现）。

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

没有 `node:fs`：`@needle/needle/node` 里全是 Node 专属 API，浏览器打包会把它换成空实现，别在浏览器代码里 import 它。要事后查有两条路：落本机 IndexedDB（下一节），或发到远端收集端（再下一节），两者可并存。

### 落本机：`createIndexedDbStore()`

一个对象两个身份：写是 `Sink`（手动 `addSink`），读是 `LogFiles`（传给 `createBrowserShell` 的 `logFiles`）。接完之后 `log.list` 列出本机日志，点文件名新窗口打开全文，手动保存就能发给排查的人——与服务端同一套交互，文件名 hover 还能看到末尾几行样本：

```ts
import { createIndexedDbStore, newLogger } from "@needle/needle";
import { createBrowserShell } from "@needle/needle/shell";

const log = newLogger({
  name: "web",
  batch: true,            // 浏览器默认逐条写，用 IDB 必须显式攒批
  flushIntervalMs: 16,    // 攒一帧再落一次
});
const store = createIndexedDbStore();
log.addSink(store);

createBrowserShell({
  element: document.getElementById("shell")!,
  auth: { users: {} },
  user: "local",
  logFiles: store,        // 读：log.list 由此可用
});

addEventListener("pagehide", () => log.dispose());   // 先 flush 再关 sink
```

默认保留 7 天 + 5000 条，写入时顺手清；按级别级联出 `info.log` / `warn.log` / `error.log` 三个虚拟文件，与 Node 文件 sink 同构。要改默认值：`createIndexedDbStore({ name, keepDays, maxRecords, minLevel })`。

已知限制：

- **崩溃瞬间最后 ~100ms（一个攒批窗口）的日志可能没提交**。这是本机留存的边界，不是发远端的替代。
- **保留期锚在设备时钟上**：时钟大幅前跳（NTP 大幅校正、VM 快照恢复）会让过期清理成批删掉近几天的日志；5000 条上限那根轴按入库顺序删，不受时钟影响。
- **无痕模式 / 部分 WebView 里 IndexedDB 直接缺失**：写静默丢弃、`log.list` 返回空，不打扰业务。
- **`read()` 无字节护栏**：单文件文本量上界 = 5000 条记录 formatLine 的总和；刻意不截断——截断会产出解析不了的日志文件。
- **库结构升级会清空既有本机日志**：v1 → v2（2026-10-23，修业务字段 `id` 撞主键）时重建了 object store，升级一次就把旧日志清掉。日志是可丢弃的证据，不做迁移拷贝。
- **日志含业务数据，长期留在用户机器上**：库不做脱敏，要不要落、落多久是产品决策。

### 发远端：sendBeacon

页面正在关闭时 `sendBeacon` 是唯一可靠的出口：

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
- **`dispose()` 不是可选的。** 面板的定时器与订阅跟着页面走；SPA 切换路由后重建 Shell，不 dispose 就多一份订阅，日志重复渲染。
- **别把日志拼进 `innerHTML`。** 面板内部只用 `createElement` + `textContent`；业务代码也别把 `msg` 拼进 HTML，那里面可能是用户输入。
