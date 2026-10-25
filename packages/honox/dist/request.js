/**
 * 请求参数不合法。`onError` 认它，映射成 4xx；它不是服务端故障，不记 error 日志。
 *
 * 两种形态：`new RequestError(message)` 等价于 400 + `bad_request`；
 * `new RequestError(status, code, message)` 给需要 409 / 422 这类状态的调用方。
 */
export class RequestError extends Error {
    status;
    code;
    constructor(first, code, message) {
        if (typeof first === "string") {
            super(first);
            this.status = 400;
            this.code = "bad_request";
        }
        else {
            // Stryker disable next-line StringLiteral: 声明过的数字形态只有 3 参（status, code, message），`?? ""` 和 `?? "bad_request"` 都是运行期兼容，不构成契约
            super(message ?? "");
            this.status = first;
            // Stryker disable next-line StringLiteral: 同上：number 形态不上传 code 不在声明里
            this.code = code ?? "bad_request";
        }
        this.name = "RequestError";
    }
}
/** 业务自己装 `onError` 时用它把参数错误转交回来（否则会被当成 500）。 */
export function isRequestError(error) {
    return error instanceof RequestError;
}
