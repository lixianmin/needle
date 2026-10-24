/**
 * 请求参数不合法。`onError` 认它，映射成 4xx；它不是服务端故障，不记 error 日志。
 *
 * 两种形态：`new RequestError(message)` 等价于 400 + `bad_request`；
 * `new RequestError(status, code, message)` 给需要 409 / 422 这类状态的调用方。
 */
export declare class RequestError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(message: string);
    constructor(status: number, code: string, message: string);
}
/** 业务自己装 `onError` 时用它把参数错误转交回来（否则会被当成 500）。 */
export declare function isRequestError(error: unknown): error is RequestError;
//# sourceMappingURL=request.d.ts.map