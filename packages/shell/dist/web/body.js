/**
 * 有上限地读完请求体。
 *
 * `content-length` 只能挡住老实请求：chunked 传输不带它，`req.text()` 会把
 * 整个 body 读进内存，读完之后再检查大小就晚了——一个未认证的请求就能把
 * 进程读到 OOM。所以这里边读边计数，超了立刻取消读端。
 *
 * 返回 null 表示超过上限；`req.body` 为 null 时返回空串。
 */
export async function readTextLimited(req, maxBytes) {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes)
        return null;
    if (req.body === null)
        return "";
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let bytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > maxBytes) {
                await reader.cancel().catch(() => { });
                return null;
            }
            chunks.push(decoder.decode(value, { stream: true }));
        }
    }
    finally {
        reader.releaseLock();
    }
    chunks.push(decoder.decode());
    return chunks.join("");
}
