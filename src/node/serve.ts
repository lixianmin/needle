import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

export interface ServeOptions {
  port: number;
  hostname?: string;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
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
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // write 返回 false 表示内核缓冲满了：等 drain 再继续，否则大响应会把内存吃光。
    if (!res.write(value)) {
      await new Promise<void>((resolve) => res.once("drain", resolve));
    }
  }
  res.end();
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
  const server = createServer((req, res) => {
    void handle(handler, req, res).catch((error: unknown) => {
      if (!res.headersSent) res.statusCode = 500;
      res.end(String(error));
    });
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
      }),
  };
}
