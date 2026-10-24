import { LEVELS } from "../types.js";
const DEFAULT_BATCH_MS = 1000;
const DEFAULT_MAX_PER_MINUTE = 20;
/** 飞书单条消息上限 30KB；按 UTF-8 字节算，给信封和 JSON 转义留 6KB 余量。 */
const MAX_TEXT_BYTES = 24_000;
function truncate(text) {
    const encoder = new TextEncoder();
    if (encoder.encode(text).length <= MAX_TEXT_BYTES) {
        return text;
    }
    // 按字节累加而不是按字符数：18000 个汉字是 54KB，飞书会直接拒收。
    let bytes = 0;
    let end = 0;
    for (const char of text) {
        const size = encoder.encode(char).length;
        if (bytes + size > MAX_TEXT_BYTES) {
            break;
        }
        bytes += size;
        end += char.length;
    }
    return `${text.slice(0, end)}…(截断)`;
}
/** 一条记录能给人看的部分：msg、Error 的 message、栈。 */
function detailOf(record) {
    const parts = [];
    if (record.msg !== undefined && record.msg !== "") {
        parts.push(record.msg);
    }
    if (typeof record.message === "string" && record.message !== "") {
        parts.push(record.message);
    }
    if (typeof record.stack === "string" && record.stack !== "") {
        parts.push(record.stack);
    }
    return parts.join("\n");
}
async function sign(secret, timestamp) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}\n${secret}`));
    let binary = "";
    for (const byte of new Uint8Array(signature)) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}
/**
 * 飞书群机器人 sink。
 *
 * 收到的已经是批量（logger 每 100ms 一次），这里再做一层窗口合并与限流：
 * 日志洪水时宁可少推几条，也不能把 webhook 打成 429 然后整片丢失。
 */
export function createLarkSink(options) {
    const batchMs = options.batchMs ?? DEFAULT_BATCH_MS;
    const maxPerMinute = options.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
    const minLevel = LEVELS[options.minLevel ?? "error"];
    const doFetch = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    // `secret: ""`（配置里留空）等同于没配：空字符串作为 HMAC key 进 WebCrypto 会抛
    // `DataError: Zero-length key is not supported`，而 send 的失败在 flush 里被静默
    // 吞掉——告警一条都发不出去，还没有任何提示。
    const secret = options.secret === undefined || options.secret === "" ? undefined : options.secret;
    let queue = [];
    let timer;
    let closed = false;
    let tokens = maxPerMinute;
    let lastRefill = now();
    function refill() {
        const at = now();
        const elapsed = at - lastRefill;
        if (elapsed <= 0) {
            return;
        }
        // 按时间比例补充，而不是每满 60 秒整桶重置：后者允许在窗口边界连发
        // 2× 配额，正好是限流要防的情况。
        lastRefill = at;
        tokens = Math.min(maxPerMinute, tokens + (elapsed / 60_000) * maxPerMinute);
    }
    async function send(lines) {
        if (lines.length === 0) {
            return;
        }
        const text = truncate(lines.join("\n"));
        const timestamp = String(Math.floor(now() / 1000));
        const body = { msg_type: "text", content: { text } };
        if (secret !== undefined) {
            body.timestamp = timestamp;
            body.sign = await sign(secret, Number(timestamp));
        }
        const response = await doFetch(options.webhook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        // 静默失败等于告警没发出去：至少留一行到 stderr。
        if (!response.ok) {
            console.error(`[logo] lark webhook 返回 HTTP ${response.status}`);
        }
    }
    async function flush() {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (queue.length === 0) {
            return;
        }
        const pending = queue;
        queue = [];
        refill();
        if (tokens < 1) {
            return; // 超出配额：这一批直接丢，不排队堆积
        }
        tokens -= 1;
        try {
            await send(pending);
        }
        catch {
            // 网络失败不该让业务日志调用抛错，也不重试——重试会把队列撑爆。
        }
    }
    const sink = ((batch) => {
        if (closed) {
            return;
        }
        for (const record of batch) {
            if (LEVELS[record.level] < minLevel) {
                continue;
            }
            queue.push(`[${record.level}] ${detailOf(record)}`.trim());
        }
        if (queue.length > 0 && timer === undefined) {
            timer = setTimeout(() => {
                timer = undefined;
                void flush();
            }, batchMs);
            timer.unref?.();
        }
    });
    sink.flush = flush;
    // dispose() 只调用带 close 的 sink。没有它，队列里最后一条 error 会随进程消失。
    sink.close = () => {
        if (closed) {
            return;
        }
        closed = true;
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        // best-effort：dispose 是同步的，进程若紧接着 exit，这次发送可能来不及完成。
        void flush();
    };
    return sink;
}
