import { describe, expect, test } from "bun:test";

import { createBuiltinCommands } from "../../src/console/builtins.js";
import { CommandError, findCommand } from "../../src/console/commands.js";
import type { CommandContext, CommandOutput } from "../../src/console/types.js";
import { createRingSink } from "../../src/core/ring.js";
import { createLogger } from "../../src/core/logger.js";
import type { LogRecord } from "../../src/core/types.js";

const metrics = { read: async () => ({ runtime: "node", uptimeMs: 1234 }) };

function setup() {
  const records = createRingSink(100);
  const commands = createBuiltinCommands({ records, metrics });
  const context = (args: string[]): CommandContext => ({
    args,
    user: "admin",
    log: createLogger({ flushIntervalMs: 0, batch: false }),
  });
  const run = async (name: string, args: string[] = []): Promise<CommandOutput> => {
    const command = findCommand(commands, name);
    if (command === undefined) throw new Error(`没有命令 ${name}`);
    return command.run(context(args));
  };
  return { records, commands, run };
}

describe("内置命令", () => {
  test("logs 默认 20 条，可指定条数", async () => {
    const { records, run } = setup();
    const logger = createLogger({ flushIntervalMs: 0, batch: false, sinks: [records] });
    for (let i = 0; i < 30; i += 1) logger.info("n", i);
    logger.flush();

    const byDefault = await run("logs");
    expect(byDefault.kind).toBe("table");
    expect((byDefault as { columns: string[] }).columns).toEqual(["time", "level", "msg"]);
    expect((byDefault as { rows: unknown[] }).rows).toHaveLength(20);

    const five = await run("logs", ["5"]);
    expect((five as { rows: unknown[] }).rows).toHaveLength(5);
  });

  test("logs 先 flush，刚写下的日志立刻可见", async () => {
    const records = createRingSink(10);
    const logger = createLogger({ flushIntervalMs: 10_000, batch: false, sinks: [records] });
    const commands = createBuiltinCommands({
      records,
      metrics,
      flush: () => logger.flush(),
    });
    const logs = findCommand(commands, "logs");

    logger.info("written just now");
    const output = (await logs?.run({ args: [], user: "admin", log: logger })) as {
      rows: unknown[][];
    };

    expect(output.rows[0]?.[2]).toBe("written just now");
  });

  test("logs 参数非法时抛 CommandError", async () => {
    const { run } = setup();
    await expect(run("logs", ["abc"])).rejects.toBeInstanceOf(CommandError);
    await expect(run("logs", ["0"])).rejects.toBeInstanceOf(CommandError);
    await expect(run("logs", ["-3"])).rejects.toBeInstanceOf(CommandError);
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

  test("logout 返回文本", async () => {
    const { run } = setup();
    expect((await run("logout")).kind).toBe("text");
  });

  test("只有 help/auth/logout 可以匿名执行", () => {
    const { commands } = setup();
    const publicNames = commands.filter((command) => command.public).map((command) => command.name);
    expect(publicNames.sort()).toEqual(["auth", "logout", "sub", "unsub"]);
  });

  test("logs 把记录渲染成表", async () => {
    const { records, run } = setup();
    records([{ time: 0, level: "info", msg: "hello" } as LogRecord]);

    const output = await run("logs");
    const rows = (output as { rows: Array<Array<string | number | null>> }).rows;
    expect(rows[0]?.[1]).toBe("info");
    expect(rows[0]?.[2]).toBe("hello");
  });
});
