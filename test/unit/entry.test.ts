import { describe, expect, test } from "bun:test";

import * as root from "../../src/index.js";

describe("包的默认入口", () => {
  test("日志、控制台、飞书 sink 都从 @needle/logo 导入", () => {
    expect(typeof root.logo.info).toBe("function");
    expect(typeof root.newLogger).toBe("function");
    expect(typeof root.createShell).toBe("function");
    expect(typeof root.createBrowserShell).toBe("function");
    expect(typeof root.mountShell).toBe("function");
    expect(typeof root.createFetchAdapter).toBe("function");
    expect(typeof root.createLarkSink).toBe("function");
  });

  test("node 专属的 API 不从默认入口导出", () => {
    // createFileSink / serve / attach 依赖 node:fs / node:http：放进默认入口
    // 会让 Workers 与浏览器打包直接失败，它们只从 ./node 出。
    expect("createFileSink" in root).toBe(false);
    expect("createLogFiles" in root).toBe(false);
    expect("serve" in root).toBe(false);
    expect("attach" in root).toBe(false);
  });
});
