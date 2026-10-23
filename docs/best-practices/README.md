# 按平台查阅

按「你要开发什么」分篇。每篇自洽——看 Chrome 扩展那篇不需要读服务端那篇，跨篇重复是故意的。

每篇都是同样的两节：**控制台怎么接**、**日志怎么初始化**（有没有文件 sink、怎么换级别、退出时怎么冲缓冲）。

| 你要开发 | 读这篇 | 一句话差异 |
|---|---|---|
| 服务端（Node / Bun / Workers） | [server.md](server.md) | 控制台和日志全功能；Node/Bun 有文件 sink，Workers 没有 |
| Chrome 扩展（MV3） | [chrome-extension.md](chrome-extension.md) | 无 fs、无 token；面板挂扩展页面，SW 只写日志 |
| 浏览器纯前端页 | [browser-client.md](browser-client.md) | 无服务器、无落盘；日志只活在这个标签页 |

三篇都成立的三条：

1. 日志先交给 logger，再由 sink 决定去哪；控制台的实时视图本身就是一块 sink。
2. 控制台是同一个内核的两个适配器：HTTP/SSE 挂服务器，DOM 挂页面；命令与输出形态两边一致。
3. 服务端上 `warn` / `error` 立即写、`info` 攒批 100ms；浏览器与扩展里探测不到可同步写的 stdout，逐条立即写出。退出前不调 `dispose()` 会丢最后一批。

平台能力对照表在根目录 README 的「三、平台支持」。
