import { afterEach, describe, expect, test } from "bun:test";

import { hasStdout, logo, stdoutSink } from "../src/index.js";
import type { LogRecord } from "../src/types.js";

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

  test("stdout 不存在（不是「有但没有 write」）时也走 console.log", () => {
    const logged: string[] = [];
    const originalLog = console.log;
    // 真实 Worker 里 `process.stdout` 可能是 undefined，这跟「有 stdout 但 write 不是函数」
    // 是两条不同的分支：前者靠 `?.` 顶住，后者靠 typeof 顶住。
    globalThis.process = { ...originalProcess, stdout: undefined } as unknown as NodeJS.Process;
    console.log = (text: string) => logged.push(text);

    try {
      stdoutSink([record("a")]);
    } finally {
      console.log = originalLog;
    }

    expect(logged).toHaveLength(1);
  });

  test("process 根本不存在（Workers）时也走 console.log", () => {
    const logged: string[] = [];
    const originalLog = console.log;
    globalThis.process = undefined as unknown as NodeJS.Process;
    console.log = (text: string) => logged.push(text);

    try {
      stdoutSink([record("a")]);
    } finally {
      console.log = originalLog;
    }

    expect(logged).toHaveLength(1);
    expect(hasStdout()).toBe(false);
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
  test("logo 开箱就能用：info 级别、直写 stdout", () => {
    const writes: string[] = [];
    globalThis.process = {
      ...originalProcess,
      stdout: { write: (text: string) => writes.push(text) },
    } as unknown as NodeJS.Process;

    logo.debug({ filtered: true });   // 默认级别 info，这条应该被丢掉
    logo.info({ probe: 1 });
    logo.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"probe":1');
    expect(writes[0]).not.toContain("filtered");
  });
});
