/**
 * 请求参数不合法。`onError` 认它，映射成 4xx；它不是服务端故障，不记 error 日志。
 *
 * 两种形态：`new RequestError(message)` 等价于 400 + `bad_request`；
 * `new RequestError(status, code, message)` 给需要 409 / 422 这类状态的调用方。
 */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string);
  constructor(status: number, code: string, message: string);
  constructor(first: string | number, code?: string, message?: string) {
    if (typeof first === "string") {
      super(first);
      this.status = 400;
      this.code = "bad_request";
    } else {
      super(message ?? "");
      this.status = first;
      this.code = code ?? "bad_request";
    }
    this.name = "RequestError";
  }
}

/** 业务自己装 `onError` 时用它把参数错误转交回来（否则会被当成 500）。 */
export function isRequestError(error: unknown): error is RequestError {
  return error instanceof RequestError;
}
