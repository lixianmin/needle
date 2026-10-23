import { describe, expect, test } from "bun:test";

import { formatTime } from "../../src/logo/line.js";

describe("formatTime", () => {
  test("固定东八区，精确到秒", () => {
    // 2026-10-22T00:00:00Z 在 +08:00 是当天 08:00:00
    expect(formatTime(Date.UTC(2026, 9, 22, 0, 0, 0))).toBe("2026-10-22T08:00:00");
    // 跨日：UTC 的 20:00 已经是东八区的次日 04:00
    expect(formatTime(Date.UTC(2026, 9, 21, 20, 0, 0))).toBe("2026-10-22T04:00:00");
  });

  test("毫秒被丢掉", () => {
    expect(formatTime(Date.UTC(2026, 9, 22, 0, 0, 0, 999))).toBe("2026-10-22T08:00:00");
  });
});
