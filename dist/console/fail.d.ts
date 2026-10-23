/**
 * 错误响应：控制台所有失败都走这里，形状固定 `{ code, message }`（spec §8.2）。
 *
 * 状态码如实反映失败类型——给 sentry、探针、网关这些只看传输层的东西用；
 * `code` 表达状态码压不住的细分（401 至少有"没带 token""token 无效""口令错"
 * 三种）。成功响应不经这里，也不加壳：页面是 HTML、事件流是 SSE、日志全文是
 * text/plain，JSON 接口直接返回自己的载荷。
 */
export declare function fail(status: number, code: string, message: string): Response;
