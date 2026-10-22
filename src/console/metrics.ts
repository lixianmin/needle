export interface MetricsOptions {
  /** 动态 import 的实现，测试用它模拟 Workers。 */
  importer?: (id: string) => Promise<unknown>;
  now?: () => number;
  /** SSE 连接数，由 createConsole 注入。 */
  connections?: () => number;
}

export interface Metrics {
  /**
   * 读取当前指标。
   *
   * 是异步的：首次调用要动态 import `node:perf_hooks` 才能判断运行时。
   * 结果缓存，后续调用只是一次对象组装。
   */
  read(): Promise<Record<string, unknown>>;
}

type PerfHooks = {
  performance?: { eventLoopUtilization?: () => { utilization: number } };
};

type ProcessLike = {
  memoryUsage?: () => { rss: number; heapUsed: number };
};

/**
 * 指标读取，两套实现共用一个入口。
 *
 * 探测方式：能不能 import 到 `node:perf_hooks`。不用 `typeof window` 之类的
 * 猜测——Workers 里没有 window，但 Node 里也可能没有；能力检测比环境猜测可靠。
 */
export function createMetrics(options: MetricsOptions = {}): Metrics {
  const importer = options.importer ?? ((id: string) => import(/* @vite-ignore */ id));
  const now = options.now ?? Date.now;
  const startedAt = now();

  let cached: Promise<Record<string, unknown>> | undefined;

  async function detect(): Promise<Record<string, unknown>> {
    const base: Record<string, unknown> = {
      uptimeMs: now() - startedAt,
      connections: options.connections?.() ?? 0,
    };

    let perf: PerfHooks;
    try {
      perf = (await importer("node:perf_hooks")) as PerfHooks;
    } catch {
      // 没有 perf_hooks 就是边缘运行时。那边也没有 memoryUsage，只报自维护的计数。
      return { runtime: "workers", ...base };
    }

    const result: Record<string, unknown> = { runtime: "node", ...base };

    const memory = (globalThis as { process?: ProcessLike }).process?.memoryUsage;
    if (typeof memory === "function") {
      const usage = memory.call((globalThis as { process?: unknown }).process);
      result.rss = usage.rss;
      result.heapUsed = usage.heapUsed;
    }

    const utilization = perf.performance?.eventLoopUtilization;
    if (typeof utilization === "function") {
      result.loopUtilization = utilization.call(perf.performance)?.utilization;
    }

    return result;
  }

  return {
    read() {
      cached ??= detect();
      return cached;
    },
  };
}
