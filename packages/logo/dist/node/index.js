export { createLogFiles } from "./log-files.js";
// 文件 sink 依赖 node:fs，所以只从 ./node 入口导出；"." 入口不会把它打进包。
export { createFileSink } from "../logo/sinks/file.js";
