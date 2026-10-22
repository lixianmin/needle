import { describe, expect, test } from "bun:test";

import { createMetrics } from "../../src/console/metrics.js";

describe("createMetrics", () => {
  test("返回运行时与启动时长", async () => {
    const metrics = createMetrics({ now: () => 5000 });
    const snapshot = await metrics.read();

    expect(typeof snapshot.uptimeMs).toBe("number");
    expect(["node", "workers"]).toContain(snapshot.runtime as string);
  });

  test("没有 perf_hooks 时走 Workers 分支，且不报内存字段", async () => {
    const metrics = createMetrics({
      now: () => 1000,
      connections: () => 3,
      importer: () => Promise.reject(new Error("no perf_hooks here")),
    });

    const snapshot = await metrics.read();
    expect(snapshot.runtime).toBe("workers");
    expect(snapshot.rss).toBeUndefined();
    expect(snapshot.heapUsed).toBeUndefined();
    expect(snapshot.connections).toBe(3);
  });

  test("探测只做一次", async () => {
    let calls = 0;
    const metrics = createMetrics({
      importer: () => {
        calls += 1;
        return Promise.reject(new Error("nope"));
      },
      now: () => 0,
    });

    await metrics.read();
    await metrics.read();

    expect(calls).toBe(1);
  });
});
