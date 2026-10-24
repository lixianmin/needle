/**
 * logo 的 Node 专属入口：凡是要 `node:` 模块的能力都从这里出。
 *
 * 根入口（`.`）不碰 `node:`，浏览器和 Workers 打包不会把它们带上；反过来，
 * 只要在浏览器里 import 了这个入口，bundler 就会把 `node:fs` 换成空实现——
 * 所以这里的东西只能在 Node 用。
 */

export { createLogFiles } from "./log-files.js";
export type { LogFilesOptions } from "./log-files.js";

export { createFileSink } from "./sinks/file.js";
export type { FileSink, FileSinkOptions } from "./sinks/file.js";
