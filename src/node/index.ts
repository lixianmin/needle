export { serve, attach } from "./serve.js";
export type { AttachOptions, ConsoleLike, RunningServer, ServeOptions } from "./serve.js";
export { createLogFiles } from "./log-files.js";
export type { LogFilesOptions } from "./log-files.js";

// 文件 sink 依赖 node:fs，所以只从 ./node 入口导出；. 入口不会把它打进包。
export { createFileSink } from "../core/logo/sinks/file.js";
export type { FileSink, FileSinkOptions } from "../core/logo/sinks/file.js";
