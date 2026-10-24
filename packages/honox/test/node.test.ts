import { describe, expect, test } from "bun:test";
import { nodeIdFromMac } from "../src/node.js";

describe("nodeIdFromMac", () => {
  test("返回 10 位范围内的整数，且多次调用一致", () => {
    const first = nodeIdFromMac();
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1023);
    expect(nodeIdFromMac()).toBe(first);
  });
});
