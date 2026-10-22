import type { LogRecord } from "../../core/types.js";
import type { ConsoleSource } from "../source.js";
import type { AuthResult, ConsoleAdapter, ConsoleEvent, ExecResult } from "./adapter.js";

/**
 * 进程内适配器：浏览器页面、Chrome 扩展里用这个。
 *
 * 没有 HTTP，没有 token —— 代码本来就跑在你的应用里，能看到控制台就等于
 * 能看到这个进程。鉴权在这一层没有意义，所以 source 用本地用户模式创建。
 */
export function createLocalAdapter(source: ConsoleSource): ConsoleAdapter {
  const listeners = new Set<(event: ConsoleEvent) => void>();
  let attached = false;
  let timers: Array<ReturnType<typeof setInterval>> = [];

  const emit = (event: ConsoleEvent): void => {
    for (const listener of listeners) listener(event);
  };

  function attach(): void {
    if (attached) return;
    attached = true;

    source.broadcast.attach({
      send(event, data) {
        if (event === "log") emit({ type: "log", record: data as LogRecord });
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
    exec(line: string): Promise<ExecResult> {
      // 本地模式没有 token：source 里配了 user，鉴权直接放行。
      return source.exec(line, null);
    },

    async authenticate(user: string, password: string): Promise<AuthResult> {
      const result = await source.authenticate(user, password);
      return result.ok ? { ok: true, user: result.user } : { ok: false, error: result.error };
    },

    logout() {
      // 本地模式没有 token 可清，保留接口是为了让 UI 不用分支。
    },

    setTopics(spec: string) {
      for (const timer of timers) clearInterval(timer);
      timers = [];
      if (spec === "") return;

      // 本地模式没有 SSE，订阅就自己起定时器——行为跟服务端一致。
      for (const part of spec.split(",")) {
        const [name, rawInterval] = part.split(":");
        const topic = source.topics.find((candidate) => candidate.name === name?.trim());
        if (topic === undefined) continue;

        const requested = rawInterval === undefined ? topic.intervalMs : Number(rawInterval);
        const intervalMs = Number.isFinite(requested)
          ? Math.min(60_000, Math.max(1_000, requested))
          : topic.intervalMs;

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
        type: "hello",
        info: {
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
      };
    },
  };
}
