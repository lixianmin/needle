import type { LogRecord } from "../../core/types.js";
import type { AuthResult, ConsoleAdapter, ConsoleEvent, ExecResult, FileResult, HandshakeInfo } from "./adapter.js";

const TOKEN_KEY = "logo.console.token";

interface FetchAdapterOptions {
  /** 控制台挂载前缀，如 "/console"。空字符串表示挂在根路径。 */
  basePath: string;
  /** SSE 的 topics 参数，如 "top:5000,mem"。 */
  topics?: string;
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 隐私模式下写不进去，那就每次刷新重登一次，不算故障。
  }
}

/** 把 SSE 文本流切成帧。跨 chunk 的半帧必须留到下一次。 */
function createFrameParser(onFrame: (event: string, data: string) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length > 0) onFrame(event, data.join("\n"));

      index = buffer.indexOf("\n\n");
    }
  };
}

/**
 * 面向 HTTP/SSE 的适配器：给服务器托管的那个页面用。
 *
 * 不用原生 EventSource，因为它不能带 Authorization 头。自己读流多写十几行，
 * 换来的是 token 能放在头里而不是 URL 里（URL 会进访问日志）。
 */
export function createFetchAdapter(options: FetchAdapterOptions): ConsoleAdapter {
  const listeners = new Set<(event: ConsoleEvent) => void>();
  // 订阅集合属于这条流，sub/unsub 改的就是它。
  let topicSpec = options.topics ?? "";
  let controller: AbortController | undefined;
  let retry = 0;
  let disposed = false;

  const emit = (event: ConsoleEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const status = (message: string, level: "info" | "warn" | "error" = "info"): void => {
    emit({ type: "status", message, level });
  };

  async function connect(): Promise<void> {
    if (disposed) return;
    controller?.abort();
    controller = new AbortController();

    const token = readToken();
    const query = topicSpec === "" ? "" : `?topics=${encodeURIComponent(topicSpec)}`;
    const headers: Record<string, string> = {};
    if (token !== null) headers.authorization = `Bearer ${token}`;

    try {
      const response = await fetch(`${options.basePath}/events${query}`, {
        headers,
        signal: controller.signal,
      });

      if (response.status === 401) {
        status("未登录：执行 login <user> <password> 后自动重连", "warn");
        return;
      }
      if (response.body === null) {
        status(`无法读取事件流（HTTP ${response.status}）`, "error");
        return;
      }

      retry = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parse = createFrameParser((event, data) => {
        try {
          if (event === "handshake") emit({ type: "handshake", info: JSON.parse(data) as HandshakeInfo });
          else if (event === "log") emit({ type: "log", record: JSON.parse(data) as LogRecord });
          else if (event === "topic") {
            const payload = JSON.parse(data) as { name: string; data: unknown };
            emit({ type: "topic", name: payload.name, data: payload.data });
          }
        } catch {
          // 单帧解析失败就跳过，没必要整条流重连。
        }
      });

      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parse(decoder.decode(chunk.value, { stream: true }));
      }

      if (!disposed) status("连接已断开，正在重连…", "warn");
    } catch (error) {
      if (disposed || controller?.signal.aborted === true) return;
      status(`连接失败：${String(error)}`, "error");
    }

    if (disposed) return;
    // 指数退避，封顶 10 秒：服务重启期间不要把浏览器打死。
    retry += 1;
    setTimeout(() => void connect(), Math.min(10_000, 500 * 2 ** retry));
  }

  return {
    async exec(line: string): Promise<ExecResult> {
      const token = readToken();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token !== null) headers.authorization = `Bearer ${token}`;

      const response = await fetch(`${options.basePath}/exec`, {
        method: "POST",
        headers,
        body: JSON.stringify({ line }),
      });

      if (response.status === 401) {
        writeToken(null);
        status("未登录：执行 login <user> <password>", "warn");
        return { ok: false, error: "unauthorized", unauthorized: true };
      }

      return (await response.json()) as ExecResult;
    },

    async fetchFile(href: string): Promise<FileResult> {
      const token = readToken();
      const headers: Record<string, string> = {};
      if (token !== null) headers.authorization = `Bearer ${token}`;

      try {
        const response = await fetch(href, { headers });
        if (response.status === 401) return { ok: false, error: "未登录：先执行 auth <user>" };
        if (!response.ok) return { ok: false, error: `读取失败（HTTP ${response.status}）` };
        return { ok: true, text: await response.text() };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },

    async authenticate(user: string, password: string): Promise<AuthResult> {
      const response = await fetch(`${options.basePath}/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, password }),
      });

      const body = (await response.json()) as {
        ok?: boolean;
        user?: string;
        token?: string;
        error?: string;
      };

      if (body.ok !== true || typeof body.token !== "string") {
        return { ok: false, error: body.error ?? `登录失败（HTTP ${response.status}）` };
      }

      writeToken(body.token);
      // 日志流是鉴权的：拿到 token 立刻重连。
      void connect();
      return { ok: true, user: body.user ?? user };
    },

    logout() {
      writeToken(null);
      // 不断开现有流：服务端不追踪会话，下一个请求开始就是匿名了。
    },

    setTopics(spec: string) {
      topicSpec = spec;
      if (listeners.size > 0) void connect();
    },

    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) void connect();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          disposed = true;
          controller?.abort();
        }
      };
    },
  };
}
