import { describe, expect, test } from "bun:test";

import { CommandError, findCommand, splitArgs } from "../src/commands.js";
import type { Command } from "../src/types.js";

const commands: Command[] = [
  { name: "help", note: "列出命令", run: () => ({ kind: "text", text: "" }) },
  { name: "log.list", note: "看日志", run: () => ({ kind: "text", text: "" }) },
];

describe("splitArgs", () => {
  test("忽略多余空白", () => {
    expect(splitArgs("  log.list   20 ")).toEqual(["log.list", "20"]);
  });

  test("空串与纯空白", () => {
    expect(splitArgs("")).toEqual([]);
    expect(splitArgs("   ")).toEqual([]);
  });

  test("不解析引号（刻意的）", () => {
    expect(splitArgs('echo "a b"')).toEqual(["echo", '"a', 'b"']);
  });
});

describe("findCommand", () => {
  test("命中返回命令", () => {
    expect(findCommand(commands, "log.list")?.note).toBe("看日志");
  });

  test("未命中返回 undefined", () => {
    expect(findCommand(commands, "nope")).toBeUndefined();
  });
});

describe("CommandError", () => {
  test("保留 message 且是 Error 子类", () => {
    const error = new CommandError("boom");
    expect(error.message).toBe("boom");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof CommandError).toBe(true);
  });
});
