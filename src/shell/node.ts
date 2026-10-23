import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";

export interface ServeOptions {
  port: number;
  hostname?: string;
}

export interface AttachOptions {
  /**Shell 挂载前缀，如 "/shell"；省略表示接管全部请求。 */
  basePath?: string;
}

/** 只要求一个 Fetch 形态的 handler，避免把 shell 包的类型拖进 node 入口。 */
export interface ShellLike {
  handler(req: Request): Promise<Response>;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
headers.append(key, item);
}
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));

  if (response.body === null) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  // 客户端断开时只有 res 会 close，body 那边收不到通知：不 cancel 的话
  // sse.ts 的 cancel() 永远不执行，订阅者与定时器就都留在进程里。
  const onClose = (): void => {
    void reader.cancel().catch(() => {});
  };
  res.once("close", onClose);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      // 断开后的 write 会触发未监听的 'error'，先判一次再写。
      if (res.destroyed || res.writableEnded) {
        break;
      }
      // write 返回 false 表示内核缓冲满了：等 drain 再继续，否则大响应会把内存吃光。
      if (!res.write(value)) {
        await new Promise<void>((resolve) => {
          const finish = (): void => {
            res.off("drain", finish);
            res.off("close", finish);
            res.off("error", finish);
            resolve();
          };
          // 断开的连接不会再有 drain，只等它就会把这条请求永久挂住。
          res.once("drain", finish);
          res.once("close", finish);
          res.once("error", finish);
        });
      }
    }
  } finally {
    res.off("close", onClose);
    void reader.cancel().catch(() => {});
  }

  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
}

async function handle(
  handler: (req: Request) => Promise<Response>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;

  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody
    ? (Readable.toWeb(req as never) as unknown as ReadableStream<Uint8Array>)
    : undefined;

  // duplex: "half" 是 undici 流式请求体的要求，RequestInit 的类型里没有它。
  const request = new Request(url, {
    method,
    headers: toHeaders(req),
    ...(body === undefined ? {} : { body, duplex: "half" }),
  } as RequestInit);

  const response = await handler(request);
  await writeResponse(response, res);
}

/** 把一个 node:http 请求交给 Fetch 形态的 handler；转不了就回 500，不让进程崩。 */
function respond(
  handler: (req: Request) => Promise<Response>,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void handle(handler, req, res).catch((error: unknown) => {
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    res.end(String(error));
  });
}

/**
 * 把 `(Request) => Response` 挂到一个 node:http 服务上。
 *
 * 库不依赖 Hono/Express：它们能做这件事，但为了挂四五条路由引入一个框架
 * 不划算。这里只做转换，路由在 handler 里。
 */
export async function serve(
  handler: (req: Request) => Promise<Response>,
  options: ServeOptions,
): Promise<RunningServer> {
  const server = createServer((req, res) => respond(handler, req, res));

  // Bun 的 node:http 里，SSE 这类长连接会让 server.close() 的回调永远不触发，
  // 连 closeAllConnections() 都救不回来。自己记住 socket，停机时直接 destroy。
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
        // SSE 是长连接，浏览器不断开就永远不进入 idle：给正在收尾的响应 250ms，
        // 然后强制断开剩下的 socket，close() 才会回调。
        const timer = setTimeout(() => {
          for (const socket of sockets) {
            socket.destroy();
          }
        }, 250);
        (timer as unknown as { unref?: () => void }).unref?.();
      }),
  };
}

function normalizeBasePath(value: string | undefined): string {
  if (value === undefined || value === "" || value === "/") {
    return "";
  }
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** 按路径段匹配：`/shell` 命中 `/shell` 与 `/shell/...`，不命中 `/shellfoo`。 */
function matchesBasePath(pathname: string, base: string): boolean {
  if (base === "") {
    return true;
  }
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * 把 Shell 挂到一个已经在跑的 node:http 服务上（裸 Node、Express、Fastify 底层都是它）。
 *
 * 做法是接管 `request` 事件：Shell 前缀内的请求交给 Fetch handler，前缀外按注册
 * 顺序原样交回给原来的 listener——所以已经挂好的 app 一行都不用改。
 *
 * 注意语义：Shell 在原来的路由/中间件**之前**处理自己的路径，不经过它们（也不受
 * 它们的 body 解析、鉴权中间件影响）。这正是 Shell 要的：它自己的 /exec 和 /events
 * 有独立的鉴权。
 */
export function attach(server: Server, target:ShellLike, options: AttachOptions = {}): void {
  const base = normalizeBasePath(options.basePath);
  const previous = server.listeners("request") as Array<
    (this: Server, req: IncomingMessage, res: ServerResponse) => void
  >;
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
    for (const listener of previous) {
      listener.call(server, req, res);
    }
  });
}
