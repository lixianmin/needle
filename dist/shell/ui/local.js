import { parseTopicSpecs } from "../sse.js";
/**
 * 进程内适配器：浏览器页面、Chrome 扩展里用这个。
 *
 * 没有 HTTP，没有 token —— 代码本来就跑在你的应用里，能看到 Shell 就等于
 * 能看到这个进程。鉴权在这一层没有意义，所以 source 用本地用户模式创建。
 */
export function createLocalAdapter(source) {
    const listeners = new Set();
    let attached = false;
    let detach;
    let timers = [];
    const emit = (event) => {
        for (const listener of listeners) {
            listener(event);
        }
    };
    function attach() {
        if (attached) {
            return;
        }
        attached = true;
        detach = source.broadcast.attach({
            send(event, data) {
                if (event === "log") {
                    emit({ type: "logs", records: data });
                }
                if (event === "topic") {
                    const payload = data;
                    emit({ type: "topic", name: payload.name, data: payload.data });
                }
            },
            close() {
                attached = false;
            },
        });
    }
    return {
        async exec(line) {
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
        fetchFile() {
            return Promise.resolve({ ok: false, error: "浏览器里没有日志文件可读，用 log.list 看不到内容" });
        },
        async authenticate(user, password) {
            const result = await source.authenticate(user, password);
            return result.ok ? { ok: true, user: result.user } : { ok: false, error: result.error };
        },
        setTopics(spec) {
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
                timers.push(setInterval(() => {
                    void Promise.resolve(topic.read())
                        .then((data) => emit({ type: "topic", name: topic.name, data }))
                        .catch((error) => emit({ type: "topic", name: topic.name, data: { error: String(error) } }));
                }, intervalMs));
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
