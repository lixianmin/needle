/**
 * 有上限地读完请求体。
 *
 * `content-length` 只能挡住老实请求：chunked 传输不带它，`req.text()` 会把
 * 整个 body 读进内存，读完之后再检查大小就晚了——一个未认证的请求就能把
 * 进程读到 OOM。所以这里边读边计数，超了立刻取消读端。
 *
 * 返回 null 表示超过上限；`req.body` 为 null 时返回空串。
 */
export declare function readTextLimited(req: Request, maxBytes: number): Promise<string | null>;
//# sourceMappingURL=body.d.ts.map