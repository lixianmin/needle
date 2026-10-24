import { describe, expect, test } from "bun:test";

import * as logoEntry from "@needle/logo";
import * as nodeEntry from "@needle/logo/node";

/**
 * logo 的两个入口：`.` 只出日志（含 lark），`./node` 只出 Node 专属能力。
 * 这两条断言是「浏览器里只用日志不会沾到 node:」的第一道闸；第二道是
 * `browser-safety.test.ts` 对真实打包产物的内容检查。
 */
describe("@needle/logo 的入口边界", () => {
  test("根入口出全部日志 API，含 lark", () => {
    expect(typeof logoEntry.logo.info).toBe("function");
    expect(typeof logoEntry.newLogger).toBe("function");
    expect(typeof logoEntry.createLarkSink).toBe("function");
    expect(typeof logoEntry.createIndexedDbStore).toBe("function");
    expect(typeof logoEntry.formatLine).toBe("function");
    expect(typeof logoEntry.toHuman).toBe("function");

    expect("createServerShell" in logoEntry).toBe(false);
    expect("mountShell" in logoEntry).toBe(false);
    expect("createFileSink" in logoEntry).toBe(false);
    expect("createLogFiles" in logoEntry).toBe(false);
    expect("serve" in logoEntry).toBe(false);
    expect("attach" in logoEntry).toBe(false);
  });

  test("./node 是 logo 的 Node 专属出口，不转手导出根入口", () => {
    expect(typeof nodeEntry.createFileSink).toBe("function");
    expect(typeof nodeEntry.createLogFiles).toBe("function");

    expect("logo" in nodeEntry).toBe(false);
    expect("newLogger" in nodeEntry).toBe(false);
    expect("serve" in nodeEntry).toBe(false);
  });
});
