import { afterEach, describe, expect, test } from "bun:test";

import { logo, stdoutSink } from "../../src/core/index.js";
import type { LogRecord } from "../../src/core/logo/types.js";

const record = (msg: string): LogRecord => ({ time: 1, level: "info", msg });

const originalProcess = globalThis.process;

afterEach(() => {
  globalThis.process = originalProcess;
});

describe("stdoutSink", () => {
  test("有 stdout 时整批只用一次 write", () => {
    const writes: string[] = [];
    globalThis.process = {
      ...originalProcess,
      stdout: { write: (text: string) => writes.push(text) },
    } as unknown as NodeJS.Process;

    stdoutSink([record("a"), record("b")]);

    expect(writes).toHaveLength(1);
    // 前缀是东八区时间 + 级别，JSON 里不再重复 time/level
    expect(writes[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} \[I\] \{"msg":"a"\}\n/);
    expect(writes[0]).toContain(' \[I\] {"msg":"b"}\n');
  });

  test("没有 stdout 时逐条 console.log", () => {
    const logged: string[] = [];
    const originalLog = console.log;
    globalThis.process = { ...originalProcess, stdout: {} } as unknown as NodeJS.Process;
    console.log = (text: string) => logged.push(text);

    try {
      stdoutSink([record("a"), record("b")]);
    } finally {
      console.log = originalLog;
    }

    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} \[I\] \{"msg":"a"\}$/);
  });

  test("空批次什么都不做", () => {
    const writes: string[] = [];
    globalThis.process = {
      ...originalProcess,
      stdout: { write: (text: string) => writes.push(text) },
    } as unknown as NodeJS.Process;

    stdoutSink([]);
    expect(writes).toHaveLength(0);
  });
});

describe("默认实例", () => {
  test("logo 是开箱可用的 logger", () => {
    expect(typeof logo.info).toBe("function");
    expect(typeof logo.flush).toBe("function");
    expect(typeof logo.error).toBe("function");
  });
});
