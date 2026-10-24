import type { Command } from "./types.js";
/**
 * 命令执行失败。source 的 `runCommand` 统一把它转成 `{ ok: false, error }`，所以命令实现
 * 里写 `throw new CommandError("...")` 就够了，不用每层判断 ok。
 */
export declare class CommandError extends Error {
    constructor(message: string);
}
/**
 * 切参数。
 *
 * 不做引号解析是刻意的：Shell 命令是手敲的短句，支持引号意味着要处理
 * 转义、引号不闭合、空参数……换来的表达能力在这些内置命令上一点也用不到。
 * 需要复杂参数就写多个命令。
 */
export declare function splitArgs(line: string): string[];
export declare function findCommand(commands: readonly Command[], name: string): Command | undefined;
//# sourceMappingURL=commands.d.ts.map