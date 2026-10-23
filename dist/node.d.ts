/**
 * Node 专属入口：凡是要 `node:` 模块的能力都从这里出。
 *
 * 根入口（`.`）与 `./shell` 都不碰 `node:`，浏览器和 Workers 打包不会把它们
 * 带上；反过来，只要在浏览器里 import 了这个入口，bundler 就会把 `node:fs`
 * 换成空实现——所以这里的东西只能在 Node 用。
 *
 * 文件 sink、日志目录读取、起 HTTP 服务合成一个入口，路径最长三段。
 */
export { createLogFiles } from "./logo/log-files.js";
export type { LogFilesOptions } from "./logo/log-files.js";
export { createFileSink } from "./logo/sinks/file.js";
export type { FileSink, FileSinkOptions } from "./logo/sinks/file.js";
export { attach, serve } from "./shell/node.js";
export type { AttachOptions, RunningServer, ServeOptions, ShellLike } from "./shell/node.js";
