import type { LogRecord } from "../../logo/index.js";
import type { ShellSource } from "../source.js";
import { parseTopicSpecs } from "../sse.js";
import type { AuthResult, ShellAdapter, ShellEvent, ExecResult, FileResult } from "./adapter.js";

/**
 * 进程内适配器：浏览器页面、Chrome 扩展里用这个。
 *
 * 没有 HTTP，没有 token —— 代码本来就跑在你的应用里，能看到 Shell 就等于
 * 能看到这个进程。鉴权在这一层没有意义，所以 source 用本地用户模式创建。
 */
/**
 * 从 href 里解出 /log/:name 的文件名：query / hash 不算，名字要解码。
 * 解码失败按没匹配处理（恶意构造的百分号序列不值得报错）。
 */
function logNameFromHref(href: string): string | null {
  const path = href.split(/[?#]/, 1)[0] ?? href;
  // 匹配末段：log.list 生成的链接带 basePath 前缀（如 /shell/log/x），口径要一致
  const match = /\/log\/([^/?#]+)$/.exec(path);
  const raw = match?.[1];
  if (raw === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function createLocalAdapter(source:ShellSource):ShellAdapter {
  const listeners = new Set<(event:ShellEvent) => void>();
  let attached = false;
  let detach: (() => void) | undefined;
  let timers: Array<ReturnType<typeof setInterval>> = [];

  const emit = (event:ShellEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  function attach(): void {
    if (attached) {
      return;
    }
    attached = true;

    detach = source.broadcast.attach({
      send(event, data) {
        if (event === "log") {
          emit({ type: "logs", records: data as LogRecord[] });
        }
        if (event === "topic") {
          const payload = data as { name: string; data: unknown };
          emit({ type: "topic", name: payload.name, data: payload.data });
        }
      },
      close() {
        attached = false;
      },
    });
  }

  return {
    async exec(line: string): Promise<ExecResult> {
      // 本地模式没有 token：source 里配了 user，鉴权直接放行。
      const result = await source.exec(line, null);
      if (result.ok) {
        return result;
      }
      // 适配器不知道 code 的各种取值，只关心"是不是没登录"，这一层转成布尔。
      return {
        ok: false,
        error: result.error,
        ...(result.code === "unauthorized" ? { unauthorized: true } : {}),
      };
    },

    fetchFile(href: string): Promise<FileResult> {
      const name = logNameFromHref(href);
      if (name === null) {
        return Promise.resolve({ ok: false, error: "浏览器里没有日志文件可读，用 log.list 看不到内容" });
      }
      const logFiles = source.logFiles;
      if (logFiles === undefined) {
        return Promise.resolve({ ok: false, error: "未配置日志存储，log.list 不可用" });
      }
      return logFiles.read(name).then((text) => {
        if (text === null) {
          return { ok: false as const, error: `日志文件不存在：${name}` };
        }
        return { ok: true as const, text };
      });
    },

    async authenticate(user: string, password: string): Promise<AuthResult> {
      const result = await source.authenticate(user, password);
      return result.ok ? { ok: true, user: result.user } : { ok: false, error: result.error };
    },

    setTopics(spec: string) {
      for (const timer of timers) {
        clearInterval(timer);
      }
      timers = [];
      if (spec === "") {
        return;
      }

      // 本地模式没有 SSE，订阅就自己起定时器——解析复用 sse 的那份，去重与
      // 上限才跟服务端一致，不会两处逻辑慢慢漂移。
      for (const { topic, intervalMs } of parseTopicSpecs(spec, source.topics)) {
        timers.push(
          setInterval(() => {
            void Promise.resolve(topic.read())
              .then((data) => emit({ type: "topic", name: topic.name, data }))
              .catch((error: unknown) =>
                emit({ type: "topic", name: topic.name, data: { error: String(error) } }),
              );
          }, intervalMs),
        );
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      attach();

      emit({
        type: "handshake",
        info: {
          title: source.title,
          version: source.version,
          user: source.user,
          commands: source.commands.map((command) => ({
            name: command.name,
            note: command.note,
            args: command.args ?? null,
          })),
          topics: source.topics.map((topic) => ({
            name: topic.name,
            note: topic.note,
            intervalMs: topic.intervalMs,
          })),
        },
      });

      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) {
          return;
        }

        // 面板卸载：定时器和广播连接一起收回。留着的话每次重新挂载都会
        // 多一份每秒读主题的 interval，broadcast.count() 也永远降不下来。
        for (const timer of timers) {
          clearInterval(timer);
        }
        timers = [];
        detach?.();
        detach = undefined;
        attached = false;
      };
    },
  };
}
