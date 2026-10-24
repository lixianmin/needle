import { describe, expect, test } from "bun:test";

import * as coreEntry from "@needle/core";

/**
 * core 包只有 `.` 一个入口：通用数据结构，不转手导出任何别的包。
 */
describe("@needle/core 的入口边界", () => {
  test("只出数据结构，不出日志与 Shell", () => {
    expect(typeof coreEntry.SortedTable).toBe("function");
    expect(typeof coreEntry.defaultComparer).toBe("function");

    expect("logo" in coreEntry).toBe(false);
    expect("newLogger" in coreEntry).toBe(false);
    expect("createServerShell" in coreEntry).toBe(false);
    expect("serve" in coreEntry).toBe(false);
  });
});
