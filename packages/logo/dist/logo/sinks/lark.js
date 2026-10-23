import { LEVELS } from "../types.js";
const DEFAULT_BATCH_MS = 1000;
const DEFAULT_MAX_PER_MINUTE = 20;
/** 飞书单条消息上限 30KB，留出信封与转义的余量。 */
const MAX_TEXT_LENGTH = 18_000;
function truncate(text) {
    return text.length <= MAX_TEXT_LENGTH ? text : `${text.slice(0, MAX_TEXT_LENGTH)}…(截断)`;
}
async function sign(secret, timestamp) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}\n${secret}`));
    let binary = "";
    for (const byte of new Uint8Array(signature))
        binary += String.fromCharCode(byte);
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
    let queue = [];
    let timer;
    let tokens = maxPerMinute;
    let lastRefill = now();
    function refill() {
        const elapsed = now() - lastRefill;
        if (elapsed < 60_000)
            return;
        tokens = maxPerMinute;
        lastRefill = now();
    }
    async function send(lines) {
        if (lines.length === 0)
            return;
        const text = truncate(lines.join("\n"));
        const timestamp = String(Math.floor(now() / 1000));
        const body = { msg_type: "text", content: { text } };
        if (options.secret !== undefined) {
            body.timestamp = timestamp;
            body.sign = await sign(options.secret, Number(timestamp));
        }
        await doFetch(options.webhook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
    }
    async function flush() {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (queue.length === 0)
            return;
        const pending = queue;
        queue = [];
        refill();
        if (tokens <= 0)
            return; // 超出配额：这一批直接丢，不排队堆积
        tokens -= 1;
        try {
            await send(pending);
        }
        catch {
            // 网络失败不该让业务日志调用抛错，也不重试——重试会把队列撑爆。
        }
    }
    const sink = ((batch) => {
        for (const record of batch) {
            if (LEVELS[record.level] < minLevel)
                continue;
            const detail = record.msg ?? "";
            queue.push(`[${record.level}] ${detail}`.trim());
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
    return sink;
}
