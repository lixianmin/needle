# 按平台查阅

根 README 讲共用的部分：Shell 是什么、命令怎么写、日志怎么初始化、怎么安装。这几篇只写**平台特有的坑**，同样的东西不再抄一遍。

| 你要开发 | 读这篇 | 一句话差异 |
|---|---|---|
| 服务端（Node / Bun） | [node-server.md](node-server.md) | 能挂到任意 HTTP 框架；有文件 sink |
| Cloudflare Workers | [node-server.md 四、Cloudflare Workers](node-server.md#四cloudflare-workers) | 没有文件系统；`auth.secret` 必须固定 |
| Chrome 扩展 | [chrome-extension.md](chrome-extension.md) | 无 fs、无 token；面板只能挂扩展页面 |
| 浏览器纯前端页 | [browser-client.md](browser-client.md) | 无服务器、无落盘；日志只活在这个标签页 |
