import { describe, expect, test } from "bun:test";

import { createBuiltinCommands } from "../../src/shell/builtins.js";
import { CommandError, findCommand } from "../../src/shell/commands.js";
import type { CommandContext, CommandOutput } from "../../src/shell/types.js";
import { newLogger } from "../../src/core/logo/logo.js";

const metrics = { read: async () => ({ runtime: "node", uptimeMs: 1234 }) };

function setup() {
  const commands = createBuiltinCommands({
    metrics,
    auth: { login: async () => null, verify: async () => null },
    basePath: "/shell",
    logFiles: {
      list: async () => [
        { name: "info.log", size: 2048, modified: 1_700_000_000_000 },
        { name: "error.log", size: 512, modified: 1_700_000_100_000 },
      ],
      read: async () => "",
    },
  });
  const context = (args: string[]): CommandContext => ({
    args,
    user: "admin",
    log: newLogger({ flushIntervalMs: 0, batch: false }),
  });
  const run = async (name: string, args: string[] = []): Promise<CommandOutput> => {
    const command = findCommand(commands, name);
    if (command === undefined) throw new Error(`没有命令 ${name}`);
    return command.run(context(args));
  };
  return { commands, run };
}

describe("内置命令", () => {
  test("log.list 列出日志文件，文件名带链接", async () => {
    const { run } = setup();
    const output = await run("log.list");

    expect(output.kind).toBe("table");
    const table = output as {
      columns: string[];
      rows: Array<Array<{ text: string; href: string } | string | number>>;
    };
    expect(table.columns).toEqual(["file", "size", "modified"]);
    expect(table.rows).toHaveLength(2);

    const first = table.rows[0]?.[0] as { text: string; href: string };
    expect(first.text).toBe("info.log");
    expect(first.href).toBe("/shell/log/info.log");
    // 大小是数字（排序用），不是字符串
    expect(table.rows[0]?.[1]).toBe(2048);
  });

  test("top 返回表格", async () => {
    const { run } = setup();
    const output = await run("top");
    expect(output.kind).toBe("table");
    expect((output as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });

  test("auth 不接收密码，只提示走密码输入框", async () => {
    const { run } = setup();

    await expect(run("auth", ["xmli", "123456"])).rejects.toBeInstanceOf(CommandError);
    await expect(run("auth", ["xmli", "123456"])).rejects.toThrow(/密码不能走命令行/);
    await expect(run("auth", [])).rejects.toBeInstanceOf(CommandError);
  });

  test("sub/unsub 只为 help 登记，直接执行会提示去控制台", async () => {
    const { run } = setup();
    await expect(run("sub", ["top"])).rejects.toBeInstanceOf(CommandError);
    await expect(run("unsub", [])).rejects.toBeInstanceOf(CommandError);
  });

  test("logout 不再是内置命令", () => {
    const { commands } = setup();
    expect(findCommand(commands, "logout")).toBeUndefined();
  });

  test("只有 auth/sub/unsub 可以匿名执行", () => {
    const { commands } = setup();
    const publicNames = commands.filter((command) => command.public).map((command) => command.name);
    expect(publicNames.sort()).toEqual(["auth", "sub", "unsub"]);
  });

});
