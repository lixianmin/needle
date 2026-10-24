// 只导入日志入口，用来量「只记日志」的真实成本：Shell 的代码应被 tree-shake 掉。
// 与 shell 那一项同口径：都量消费者拿到的 dist 产物，不量源码。
export { logo } from "../packages/logo/dist/index.js";
