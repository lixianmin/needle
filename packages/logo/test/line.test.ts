import { describe, expect, test } from "bun:test";

import { formatLine, formatTime, parseLine } from "../src/line.js";
import type { LogRecord } from "../src/types.js";

// 2026-10-22T00:00:00Z = 东八区 08:00:00
const at = Date.UTC(2026, 9, 22, 0, 0, 0);
const base = { time: at, level: "info" as const };

describe("formatLine", () => {
  test("前缀是东八区时间与级别，后面是 JSON", () => {
    expect(formatLine({ ...base, msg: "burst", seq: 1 })).toBe(
      '2026-10-22T08:00:00 [I] {"msg":"burst","seq":1}',
    );
  });

  test("time 与 level 不进 JSON", () => {
    const line = formatLine({ ...base, level: "error", msg: "boom" });
    expect(line).toBe('2026-10-22T08:00:00 [E] {"msg":"boom"}');
    expect(line).not.toContain('"time"');
    expect(line).not.toContain('"level"');
  });

  test("各级别缩写", () => {
    expect(formatLine({ ...base, level: "debug", msg: "d" })).toContain("[D]");
    expect(formatLine({ ...base, level: "warn", msg: "w" })).toContain("[W]");
  });

  test("没有附加字段时是空对象", () => {
    expect(formatLine({ ...base })).toBe("2026-10-22T08:00:00 [I] {}");
  });

  test("调用点与函数名进前缀（照 Go 版 logo），不进 JSON", () => {
    const line = formatLine({ ...base, site: "request-log.ts:28", fn: "requestLog", msg: "-->" });
    expect(line).toBe('2026-10-22T08:00:00 [I] request-log.ts:28 [requestLog()] {"msg":"-->"}');
    expect(line).not.toContain('"site"');
    expect(line).not.toContain('"fn"');
  });

  test("只有 site 没有 fn 时不出 [()]", () => {
    expect(formatLine({ ...base, site: "main.ts:9", msg: "x" })).toBe(
      '2026-10-22T08:00:00 [I] main.ts:9 {"msg":"x"}',
    );
  });

  test("module 进前缀、不进 JSON；与 site 同义时 site 优先", () => {
    expect(formatLine({ ...base, module: "bots.ts", path: "/bots" })).toBe(
      '2026-10-22T08:00:00 [I] bots.ts {"path":"/bots"}',
    );
    expect(formatLine({ ...base, site: "bots.ts:15", module: "bots.ts" })).toContain(
      "[I] bots.ts:15 {",
    );
  });
});

describe("parseLine", () => {
  test("能把 JSON 载荷取回来", () => {
    const line = formatLine({ ...base, msg: "burst", seq: 1, total: 2 });
    expect(parseLine(line)).toEqual({ msg: "burst", seq: 1, total: 2 });
  });

  test("外部手搓的记录带循环引用也不炸：退回 safeStringify", () => {
    // buildRecord 产出的记录已经 sanitize 过，正常路径直接 JSON.stringify；
    // 这条护的是绕开 buildRecord 直接调 formatLine 的情况。
    const record: LogRecord = { ...base, msg: "loop" };
    record.self = record;

    expect(() => formatLine(record)).not.toThrow();
    expect(formatLine(record)).toContain("[Circular]");
  });
});

describe("formatTime", () => {
  test("同一秒内复用前缀，跨秒重算，回退的时间也不会串", () => {
    expect(formatTime(at)).toBe("2026-10-22T08:00:00");
    expect(formatTime(at + 999)).toBe("2026-10-22T08:00:00");
    expect(formatTime(at + 1000)).toBe("2026-10-22T08:00:01");
    // 缓存不能把「上一次算过的秒」当成单调递增的假设
    expect(formatTime(at)).toBe("2026-10-22T08:00:00");
    expect(formatTime(at - 1000)).toBe("2026-10-22T07:59:59");
  });
});
