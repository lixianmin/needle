export interface MetricsOptions {
    now?: () => number;
    /** SSE 连接数，由 createServerShell 注入。 */
    connections?: () => number;
}
export interface Metrics {
    read(): Promise<Record<string, unknown>>;
}
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
export declare function createMetrics(options?: MetricsOptions): Metrics;
