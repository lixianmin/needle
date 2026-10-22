import { afterEach, describe, expect, test } from "bun:test";

import { createMetrics } from "../../src/console/metrics.js";

const originalProcess = globalThis.process;

afterEach(() => {
  globalThis.process = originalProcess;
});

describe("createMetrics", () => {
  test("Node 上返回真实读数", async () => {
    const snapshot = await createMetrics({ now: () => 5000 }).read();
    expect(snapshot.runtime).toBe("node");
    expect(typeof snapshot.uptimeMs).toBe("number");
    expect(typeof snapshot.rss).toBe("number");
  });

  test("没有 process.memoryUsage 时走边缘分支", async () => {
    globalThis.process = {} as unknown as NodeJS.Process;

    const snapshot = await createMetrics({ now: () => 1000, connections: () => 3 }).read();
    expect(snapshot.runtime).toBe("workers");
    expect(snapshot.rss).toBeUndefined();
    expect(snapshot.heapUsed).toBeUndefined();
    expect(snapshot.connections).toBe(3);
  });

  test("只探测一次，后续读取返回同一结果", async () => {
    const metrics = createMetrics();
    const first = await metrics.read();
    const second = await metrics.read();
    expect(first).toBe(second);
  });
});
