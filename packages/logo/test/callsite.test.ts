import { describe, expect, test } from "bun:test";
import { captureCallSite } from "../src/logo.js";

describe("captureCallSite", () => {
  test("返回调用方那一帧的 文件:行，不是本库文件", () => {
    const here = captureCallSite();
    expect(here?.site).toMatch(/^callsite\.test\.ts:\d+$/);
    expect(here?.site).not.toContain("logo.ts");
  });
});
