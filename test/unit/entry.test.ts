import { describe, expect, test } from "bun:test";

import * as nodeEntry from "../../src/node.js";
import * as rootEntry from "../../src/index.js";
import * as shellEntry from "../../src/shell/index.js";

/**
 * 单包三个入口的边界。包名只有一个（`@needle/needle`），但入口按环境分：
 * `.` 只有日志、`./shell` 只有 Shell 、`./node` 收下所有 Node 专属能力。
 *
 * 这三条断言是「浏览器里只用日志不会沾到 node:」的第一道闸；第二道是
 * `browser-safety.test.ts` 对真实打包产物的内容检查。
 */
describe("三个入口的边界", () => {
  test("根入口只出日志，不出 shell，也不出 Node 专属能力", () => {
    expect(typeof rootEntry.logo.info).toBe("function");
    expect(typeof rootEntry.newLogger).toBe("function");
    expect(typeof rootEntry.createLarkSink).toBe("function");

    expect("createServerShell" in rootEntry).toBe(false);
    expect("mountShell" in rootEntry).toBe(false);
    expect("createFileSink" in rootEntry).toBe(false);
    expect("createLogFiles" in rootEntry).toBe(false);
    expect("serve" in rootEntry).toBe(false);
    expect("attach" in rootEntry).toBe(false);
  });

  test("./shell 出 Shell API，但不转手导出 logo，也不出 Node 专属能力", () => {
    expect(typeof shellEntry.createServerShell).toBe("function");
    expect(typeof shellEntry.createBrowserShell).toBe("function");
    expect(typeof shellEntry.mountShell).toBe("function");
    expect(typeof shellEntry.createFetchAdapter).toBe("function");

    // shell 依赖 logo 打日志，但不在自己的入口里转手导出它。
    expect("logo" in shellEntry).toBe(false);
    expect("newLogger" in shellEntry).toBe(false);

    expect("createFileSink" in shellEntry).toBe(false);
    expect("serve" in shellEntry).toBe(false);
    expect("attach" in shellEntry).toBe(false);
  });

  test("./node 是 Node 专属能力的唯一出口", () => {
    expect(typeof nodeEntry.createFileSink).toBe("function");
    expect(typeof nodeEntry.createLogFiles).toBe("function");
    expect(typeof nodeEntry.serve).toBe("function");
    expect(typeof nodeEntry.attach).toBe("function");
  });
});
