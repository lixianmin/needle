export interface MetricsOptions {
  now?: () => number;
  /** SSE 连接数，由 createServerShell 注入。 */
  connections?: () => number;
}

export interface Metrics {
  read(): Promise<Record<string, unknown>>;
}

type ProcessLike = {
  memoryUsage?: () => { rss: number; heapUsed: number };
};

type PerformanceLike = {
  eventLoopUtilization?: () => { utilization: number };
};

/**
 * 指标读取。
 *
 * 探测方式只看能力，不做 import：`import(变量)` 在 Workers 里是非法的
 * （workerd 要求静态模块说明符，运行到就报 ERR_MODULE_DYNAMIC_SPEC），
 * 这一条是 miniflare 集成测试抓出来的，不是猜的。
 *
 * 有没有 `process.memoryUsage` 就足以区分：边缘运行时要么没有 process，
 * 要么只有个残缺的替身。
 */
export function createMetrics(options: MetricsOptions = {}): Metrics {
  const now = options.now ?? Date.now;
  const startedAt = now();

  /**
   * 同一秒内复用一次探测，跨秒重新读——之前一缓存就是永久，top 永远返回历史值。
   * 用 900ms 而不是 1000ms：top 主题的 interval 就是 1000ms，留点余量免得太
   * 抖一下就把上一秒的快照又推一遍。
   */
  const CACHE_TTL_MS = 900;
  let cached: Promise<Record<string, unknown>> | undefined;
  let cachedAt = 0;

  function detect(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      uptimeMs: now() - startedAt,
      connections: options.connections?.() ?? 0,
    };

    const proc = (globalThis as { process?: ProcessLike }).process;
    if (typeof proc?.memoryUsage !== "function") {
      return { runtime: "workers", ...base };
    }

    const usage = proc.memoryUsage();
    const result: Record<string, unknown> = {
      runtime: "node",
      ...base,
      rss: usage.rss,
      heapUsed: usage.heapUsed,
    };

    // Node 的全局 performance 带 eventLoopUtilization；Bun 没有就跳过这一项，
    // 不为了一个可选指标引入 import。
    const utilization = (globalThis as { performance?: PerformanceLike }).performance
      ?.eventLoopUtilization;
    if (typeof utilization === "function") {
      result.loopUtilization = utilization.call(performance)?.utilization;
    }

    return result;
  }

  return {
    read() {
      const at = now();
      // at < cachedAt 是时钟回拨：立刻重新探测，别在追平之前一直返回旧快照。
      if (cached === undefined || at < cachedAt || at - cachedAt >= CACHE_TTL_MS) {
        cached = Promise.resolve(detect());
        cachedAt = at;
      }

      return cached;
    },
  };
}
