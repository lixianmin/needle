# 按环境查阅

按「你要开发什么」分篇。每篇自洽——看 Chrome 扩展那篇不需要读服务端那篇，跨篇重复是故意的。

| 你要开发 | 读这篇 | 一句话差异 |
|---|---|---|
| Hono 服务端（Node / Bun / Workers） | [hono-server.md](hono-server.md) | 有进程、有 token，Node/Bun 上还能落盘 |
| Chrome 扩展（MV3） | [chrome-extension.md](chrome-extension.md) | 无 fs、无 token，service worker 随时会被杀 |
| 浏览器纯前端页 | [browser-client.md](browser-client.md) | 无服务器、无落盘，日志只活在这个标签页 |

三篇都成立的三条：

1. 日志先到 `logo`（进程内环形缓冲），sink 决定它最终去哪；控制台的实时视图就是其中一块 sink。
2. 控制台是同一个 `ConsoleSource` 的两个适配器：HTTP/SSE 挂服务器，DOM 挂页面。命令与输出形态两边一致。
3. `warn` / `error` 立即写，`info` 攒批（默认 100ms）；进程退出前不调 `dispose()` 会丢最后一批。

运行时能力的完整对照表在根目录 README 的「能力边界」。
