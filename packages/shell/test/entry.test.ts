import { describe, expect, test } from "bun:test";

import * as shellEntry from "@needle/shell";
import * as nodeEntry from "@needle/shell/node";

/**
 * shell 的两个入口：`.` 出 Shell API（含浏览器面板），`./node` 只出 serve / attach。
 * shell 依赖 logo，但不在自己的入口里转手导出它。
 */
describe("@needle/shell 的入口边界", () => {
  test("根入口出 Shell API，不转手导出 logo", () => {
    expect(typeof shellEntry.createServerShell).toBe("function");
    expect(typeof shellEntry.createBrowserShell).toBe("function");
    expect(typeof shellEntry.mountShell).toBe("function");
    expect(typeof shellEntry.createFetchAdapter).toBe("function");
    expect(typeof shellEntry.table).toBe("function");

    expect("logo" in shellEntry).toBe(false);
    expect("newLogger" in shellEntry).toBe(false);
    expect("createFileSink" in shellEntry).toBe(false);
    expect("createLogFiles" in shellEntry).toBe(false);
    expect("serve" in shellEntry).toBe(false);
    expect("attach" in shellEntry).toBe(false);
  });

  test("./node 是 shell 的 Node 专属出口", () => {
    expect(typeof nodeEntry.serve).toBe("function");
    expect(typeof nodeEntry.attach).toBe("function");

    expect("createServerShell" in nodeEntry).toBe(false);
    expect("createFileSink" in nodeEntry).toBe(false);
  });
});
