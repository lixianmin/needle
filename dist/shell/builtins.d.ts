import type { Metrics } from "./metrics.js";
import type { Auth } from "./auth.js";
import type { LogFiles } from "../logo/index.js";
import type { Command } from "./types.js";
export interface BuiltinDeps {
    metrics: Metrics;
    auth: Auth;
    /** 日志目录端口；没注入就说明这个宿主没有文件系统。 */
    logFiles?: LogFiles;
    /** 拼日志文件链接用，如 "/shell"。 */
    basePath: string;
}
/** help 由调用方在合并自定义命令之后再插入——它要看到全量，而不是只有内置的。 */
export declare function createHelpCommand(list: () => readonly Command[]): Command;
/**
 * 内置命令。
 *
 * 每个命令一个工厂函数，组装集中在一处——比一个大 switch 好读，也让
 * "新增一个命令"这件事只有一种写法。
 */
export declare function createBuiltinCommands(deps: BuiltinDeps): Command[];
