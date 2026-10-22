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
export function createMetrics(options = {}) {
    const now = options.now ?? Date.now;
    const startedAt = now();
    let cached;
    function detect() {
        const base = {
            uptimeMs: now() - startedAt,
            connections: options.connections?.() ?? 0,
        };
        const proc = globalThis.process;
        if (typeof proc?.memoryUsage !== "function") {
            return { runtime: "workers", ...base };
        }
        const usage = proc.memoryUsage();
        const result = {
            runtime: "node",
            ...base,
            rss: usage.rss,
            heapUsed: usage.heapUsed,
        };
        // Node 的全局 performance 带 eventLoopUtilization；Bun 没有就跳过这一项，
        // 不为了一个可选指标引入 import。
        const utilization = globalThis.performance
            ?.eventLoopUtilization;
        if (typeof utilization === "function") {
            result.loopUtilization = utilization.call(performance)?.utilization;
        }
        return result;
    }
    return {
        read() {
            cached ??= Promise.resolve(detect());
            return cached;
        },
    };
}
