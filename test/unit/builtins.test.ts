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
  const commands = createBuiltinCommands({
    records,
    metrics,
    env: { HOME: "/root", PATH: "/bin", SECRET_KEY: "hunter2" },
  });
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
  test("help 列出所有命令及其说明", async () => {
    const { commands, run } = setup();
    const output = await run("help");

    expect(output.kind).toBe("text");
    const text = (output as { text: string }).text;
    for (const command of commands) {
      expect(text).toContain(command.name);
      expect(text).toContain(command.note);
    }
  });

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

  test("logs 参数非法时抛 CommandError", async () => {
    const { run } = setup();
    await expect(run("logs", ["abc"])).rejects.toBeInstanceOf(CommandError);
    await expect(run("logs", ["0"])).rejects.toBeInstanceOf(CommandError);
    await expect(run("logs", ["-3"])).rejects.toBeInstanceOf(CommandError);
  });

  test("ps 返回表格", async () => {
    const { run } = setup();
    const output = await run("ps");
    expect(output.kind).toBe("table");
    expect((output as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
  });

  test("env 默认打码，--show 显真值", async () => {
    const { run } = setup();

    const masked = await run("env");
    const maskedRows = (masked as { rows: Array<Array<string | number | null>> }).rows;
    expect(maskedRows.map((row) => row[1])).toEqual(["***", "***", "***"]);

    const shown = await run("env", ["SECRET_KEY", "--show"]);
    expect((shown as { rows: Array<Array<string | number | null>> }).rows).toEqual([
      ["SECRET_KEY", "hunter2"],
    ]);
  });

  test("env 没有匹配项时返回空表而不抛", async () => {
    const { run } = setup();
    const output = await run("env", ["NOPE"]);
    expect((output as { rows: unknown[] }).rows).toEqual([]);
  });

  test("auth 不接收密码，只提示走密码输入框", async () => {
    const { run } = setup();

    await expect(run("auth", ["xmli", "123456"])).rejects.toBeInstanceOf(CommandError);
    await expect(run("auth", ["xmli", "123456"])).rejects.toThrow(/密码不能走命令行/);
    await expect(run("auth", [])).rejects.toBeInstanceOf(CommandError);
  });

  test("logout 返回文本", async () => {
    const { run } = setup();
    expect((await run("logout")).kind).toBe("text");
  });

  test("只有 help/auth/logout 可以匿名执行", () => {
    const { commands } = setup();
    const publicNames = commands.filter((command) => command.public).map((command) => command.name);
    expect(publicNames.sort()).toEqual(["auth", "help", "logout"]);
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
