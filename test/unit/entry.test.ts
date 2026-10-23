import { describe, expect, test } from "bun:test";

import * as logoPkg from "../../packages/logo/src/index.js";
import * as shellPkg from "../../packages/shell/src/index.js";

describe("两个包的边界", () => {
  test("@needle/logo 只出日志，不出 shell", () => {
    expect(typeof logoPkg.logo.info).toBe("function");
    expect(typeof logoPkg.newLogger).toBe("function");
    expect(typeof logoPkg.createLarkSink).toBe("function");
    expect("createShell" in logoPkg).toBe(false);
    expect("mountShell" in logoPkg).toBe(false);
  });

  test("@needle/shell 出 shell 的 API，但不重新导出 logo", () => {
    expect(typeof shellPkg.createShell).toBe("function");
    expect(typeof shellPkg.createBrowserShell).toBe("function");
    expect(typeof shellPkg.mountShell).toBe("function");
    expect(typeof shellPkg.createFetchAdapter).toBe("function");
    // shell 依赖 logo 打日志，但不在自己的入口里转手导出它。
    expect("logo" in shellPkg).toBe(false);
    expect("newLogger" in shellPkg).toBe(false);
  });

  test("node 专属的 API 不出现在任一包的默认入口", () => {
    // createFileSink / serve / attach 依赖 node:fs / node:http：放进默认入口
    // 会让 Workers 与浏览器打包直接失败，它们只从各自的 ./node 出。
    for (const pkg of [logoPkg, shellPkg]) {
      expect("createFileSink" in pkg).toBe(false);
      expect("createLogFiles" in pkg).toBe(false);
      expect("serve" in pkg).toBe(false);
      expect("attach" in pkg).toBe(false);
    }
  });
});
