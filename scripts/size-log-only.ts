// 只导入日志入口，用来量「只记日志」的真实成本：Shell 的代码应被 tree-shake 掉。
export { logo } from "../packages/logo/src/index.js";
