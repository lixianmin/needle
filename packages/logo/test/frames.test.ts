import { describe, expect, test } from "bun:test";

import { parseFrame, pruneInternalFrames } from "../src/logo.js";

/**
 * 栈裁剪是「error 日志里只有调用方，不掺我们自己的帧」的唯一实现。
 *
 * 拿合成帧来测：真栈的格式由运行时决定，凑不出「无函数名」「Windows 反斜杠」
 * 「行尾空格」这些边角，而分支恰好都在这些边角上。
 */
describe("parseFrame", () => {
  test("带函数名的标准帧", () => {
    expect(parseFrame("    at getBots (/app/api/bots.ts:12:34)")).toEqual({ file: "/app/api/bots.ts" });
  });

  test("带 async 前缀的帧", () => {
    expect(parseFrame("    at async getBots (/app/api/bots.ts:12:34)")).toEqual({
      file: "/app/api/bots.ts",
    });
  });

  test("没有函数名的帧（匿名 / 顶层）", () => {
    expect(parseFrame("    at /app/api/bots.ts:12:34")).toEqual({ file: "/app/api/bots.ts" });
  });

  test("缩进不止一个空格、函数名与括号之间不止一个空格", () => {
    expect(parseFrame("        at foo  (/app/api/bots.ts:12:34)")).toEqual({ file: "/app/api/bots.ts" });
  });

  test("行尾有多余空白仍然解析（栈里偶尔带 \\r）", () => {
    expect(parseFrame("    at foo (/app/api/bots.ts:12:34)   ")).toEqual({ file: "/app/api/bots.ts" });
    expect(parseFrame("    at foo (/app/api/bots.ts:12:34)\r")).toEqual({ file: "/app/api/bots.ts" });
  });

  test("at 后面不止一个空格也认", () => {
    expect(parseFrame("    at  foo (/app/api/bots.ts:12:34)")).toEqual({ file: "/app/api/bots.ts" });
  });

  test("帧后面还挂着别的文字就不算帧（否则会把日志正文当路径）", () => {
    expect(parseFrame("    at foo (/app/api/bots.ts:12:34) extra")).toBeUndefined();
  });

  test("不以 at 开头的行（Error 头行、源码行）都不是帧", () => {
    expect(parseFrame("Error: boom")).toBeUndefined();
    expect(parseFrame("xx    at foo (/app/a.ts:1:2)")).toBeUndefined();
  });

  test("没有文件名的帧返回 undefined", () => {
    expect(parseFrame("    at foo (:12:34)")).toBeUndefined();
  });
});

describe("pruneInternalFrames", () => {
  const frames = [
    "    at emit (/repo/packages/logo/src/logo.ts:230:5)",
    "    at log (/repo/packages/logo/src/logo.ts:268:15)",
    "    at getBots (/repo/app/api/bots.ts:12:34)",
  ];

  test("基准目录及其子目录的帧全部剪掉，别的目录保留", () => {
    // 前缀匹配：`<dir>/` 开头的都算内部，所以 src/sinks/ 也在里面。
    // 要让 sinks 的帧留下，基准目录就得换成 src/sinks——这本就是「不写死路径」的用意。
    const withSink = [...frames, "    at write (/repo/packages/logo/src/sinks/file.ts:158:9)"];
    expect(pruneInternalFrames(withSink, "/repo/packages/logo/src/logo.ts")).toEqual([
      "    at getBots (/repo/app/api/bots.ts:12:34)",
    ]);
    expect(pruneInternalFrames(withSink, "/repo/packages/logo/src/sinks/file.ts")).toEqual([
      "    at emit (/repo/packages/logo/src/logo.ts:230:5)",
      "    at log (/repo/packages/logo/src/logo.ts:268:15)",
      "    at getBots (/repo/app/api/bots.ts:12:34)",
    ]);
  });

  test("Windows 的反斜杠路径同样处理", () => {
    const windows = [
      "    at emit (C:\\repo\\packages\\logo\\src\\logo.ts:230:5)",
      "    at getBots (C:\\repo\\app\\api\\bots.ts:12:34)",
    ];
    expect(pruneInternalFrames(windows, "C:\\repo\\packages\\logo\\src\\logo.ts")).toEqual([
      "    at getBots (C:\\repo\\app\\api\\bots.ts:12:34)",
    ]);
  });

  test("originFile 没有目录分隔符时一帧都不剪（相对文件名不该吃掉整份栈）", () => {
    expect(pruneInternalFrames(frames, "logo.ts")).toEqual(frames);
    // 单字符文件名同样没有目录：早先 slice(0, -1) 会把 "a" 切成空串，逻辑靠巧合才对
    expect(pruneInternalFrames(frames, "a")).toEqual(frames);

    // 「没有目录」的后果要真能验证：同前缀的目录不能被当成内部目录吃掉
    const samePrefix = ["    at x (/repo/app/logo.t/file.ts:1:2)"];
    expect(pruneInternalFrames(samePrefix, "logo.ts")).toEqual(samePrefix);
  });

  test("返回的是新数组，不改入参", () => {
    const input = [...frames];
    const output = pruneInternalFrames(input, "/repo/packages/logo/src/logo.ts");
    expect(output).not.toBe(input);
    expect(input).toEqual(frames);
  });
});
