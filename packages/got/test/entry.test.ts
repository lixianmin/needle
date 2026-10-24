import { describe, expect, test } from "bun:test";

import * as gotEntry from "@needle/got";

/**
 * got 包只有 `.` 一个入口：通用数据结构，不转手导出任何别的包。
 */
describe("@needle/got 的入口边界", () => {
  test("只出数据结构，不出日志与 Shell", () => {
    expect(typeof gotEntry.SortedTable).toBe("function");
    expect(typeof gotEntry.defaultComparer).toBe("function");

    expect("logo" in gotEntry).toBe(false);
    expect("newLogger" in gotEntry).toBe(false);
    expect("createServerShell" in gotEntry).toBe(false);
    expect("serve" in gotEntry).toBe(false);
  });
});
