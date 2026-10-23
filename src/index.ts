// 默认入口：日志、控制台、飞书 sink 都在这里。
//
// 文件 sink、`serve` / `attach` 依赖 node: 模块，只从 ./node 导出——放进这里会让
// Workers / 浏览器打包直接失败（test/integration/workers.test.ts 守着这条）。
export * from "./core/index.js";
export * from "./shell/index.js";
export * from "./core/logo/sinks/lark.js";
