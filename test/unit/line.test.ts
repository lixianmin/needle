import { describe, expect, test } from "bun:test";

import { formatLine, parseLine } from "../../src/logo/line.js";

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
});

describe("parseLine", () => {
  test("能把 JSON 载荷取回来", () => {
    const line = formatLine({ ...base, msg: "burst", seq: 1, total: 2 });
    expect(parseLine(line)).toEqual({ msg: "burst", seq: 1, total: 2 });
  });

  test("畸形行返回 null", () => {
    expect(parseLine("not a log line")).toBeNull();
    expect(parseLine("2026-10-22T08:00:00 [I] {broken")).toBeNull();
  });
});
