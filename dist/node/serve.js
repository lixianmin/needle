import { createServer } from "node:http";
import { Readable } from "node:stream";
function toHeaders(req) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined)
            continue;
        if (Array.isArray(value))
            for (const item of value)
                headers.append(key, item);
        else
            headers.set(key, value);
    }
    return headers;
}
async function writeResponse(response, res) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body === null) {
        res.end();
        return;
    }
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        // write 返回 false 表示内核缓冲满了：等 drain 再继续，否则大响应会把内存吃光。
        if (!res.write(value)) {
            await new Promise((resolve) => res.once("drain", resolve));
        }
    }
    res.end();
}
async function handle(handler, req, res) {
    const method = req.method ?? "GET";
    const host = req.headers.host ?? "localhost";
    const url = `http://${host}${req.url ?? "/"}`;
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody
        ? Readable.toWeb(req)
        : undefined;
    // duplex: "half" 是 undici 流式请求体的要求，RequestInit 的类型里没有它。
    const request = new Request(url, {
        method,
        headers: toHeaders(req),
        ...(body === undefined ? {} : { body, duplex: "half" }),
    });
    const response = await handler(request);
    await writeResponse(response, res);
}
/** 把一个 node:http 请求交给 Fetch 形态的 handler；转不了就回 500，不让进程崩。 */
function respond(handler, req, res) {
    void handle(handler, req, res).catch((error) => {
        if (!res.headersSent)
            res.statusCode = 500;
        res.end(String(error));
    });
}
/**
 * 把 `(Request) => Response` 挂到一个 node:http 服务上。
 *
 * 库不依赖 Hono/Express：它们能做这件事，但为了挂四五条路由引入一个框架
 * 不划算。这里只做转换，路由在 handler 里。
 */
export async function serve(handler, options) {
    const server = createServer((req, res) => respond(handler, req, res));
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.hostname, () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : options.port;
    return {
        port,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
        }),
    };
}
function normalizeBasePath(value) {
    if (value === undefined || value === "" || value === "/")
        return "";
    const trimmed = value.replace(/\/+$/, "");
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
/** 按路径段匹配：`/console` 命中 `/console` 与 `/console/...`，不命中 `/consolefoo`。 */
function matchesBasePath(pathname, base) {
    if (base === "")
        return true;
    return pathname === base || pathname.startsWith(`${base}/`);
}
/**
 * 把控制台挂到一个已经在跑的 node:http 服务上（裸 Node、Express、Fastify 底层都是它）。
 *
 * 做法是接管 `request` 事件：控制台前缀内的请求交给 Fetch handler，前缀外按注册
 * 顺序原样交回给原来的 listener——所以已经挂好的 app 一行都不用改。
 *
 * 注意语义：控制台在原来的路由/中间件**之前**处理自己的路径，不经过它们（也不受
 * 它们的 body 解析、鉴权中间件影响）。这正是控制台要的：它自己的 /exec 和 /events
 * 有独立的鉴权。
 */
export function attach(server, target, options = {}) {
    const base = normalizeBasePath(options.basePath);
    const previous = server.listeners("request");
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (matchesBasePath(pathname, base)) {
            respond(target.handler, req, res);
            return;
        }
        // 没有原 handler 时不能什么都不做：请求会挂到超时。
        if (previous.length === 0) {
            res.statusCode = 404;
            res.end();
            return;
        }
        for (const listener of previous)
            listener.call(server, req, res);
    });
}
