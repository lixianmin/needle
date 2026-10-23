/**
 * 错误响应的唯一出口（spec §8.2）。
 *
 * 每个方法锁死一种失败：状态码与 `code` 都写在这里，调用方只给 `message` ——
 * 不用记 401 配哪个 code、404 又配哪个。一个状态码只配一个 `code`，同一种状态
 * 里的细分靠 `message` 表达。
 *
 * 成功响应不经过这里，也不加壳：页面是 HTML、事件流是 SSE、日志全文是
 * `text/plain`、JSON 接口直接返回自己的载荷。
 */
function fail(status, code, message) {
    return Response.json({ code, message }, { status });
}
export const ResponseX = {
    /**
     * 逃生口：8 个具名方法没覆盖的情况（403、429 之类，或某个领域专属 code）。
     * 同一个 code 用到第二次就该补成一个具名方法——名字比调用方记住数字强。
     */
    fail,
    /** 400：请求本身不合法（body 不是 JSON、字段类型不对、空命令、命令不存在）。 */
    badRequest: (message) => fail(400, "bad_request", message),
    /** 401：没带 token 或 token 无效。 */
    unauthorized: (message) => fail(401, "unauthorized", message),
    /** 401：口令错。与 unauthorized 分开，因为客户端该做的事不一样（重新登录 ≠ 改密码）。 */
    badCredentials: (message) => fail(401, "bad_credentials", message),
    /** 404：路径或方法没命中、日志文件不存在。 */
    notFound: (message) => fail(404, "not_found", message),
    /** 413：请求体超过上限。 */
    payloadTooLarge: (message) => fail(413, "payload_too_large", message),
    /** 500：命令抛错或服务内部出错。 */
    internalError: (message) => fail(500, "internal_error", message),
    /** 503：`dispose()` 之后，服务不再可用。 */
    unavailable: (message) => fail(503, "service_unavailable", message),
    /** 504：命令超时。 */
    gatewayTimeout: (message) => fail(504, "gateway_timeout", message),
};
