/**
 * beans 目录的统一入口：业务只 `import { BotsBody } from "../beans/index.js"`。
 *
 * 两条 export 各自有活：`./bots.js` 出的是手写 class（类型来源），
 * `./bots.generated.js` 出 schema 并在模块加载时 `registerModel()` 完成注册。
 * 加了新 bean 文件后在这里补一行。
 */
export * from "./bots.js";
export * from "./bots.generated.js";
