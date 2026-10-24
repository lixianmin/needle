const TOKEN_KEY = "logo.shell.token";
function readToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    }
    catch {
        return null;
    }
}
/** 失败体固定是 `{ code, message }`（spec §8.2）；解析不了就退回状态码。 */
async function errorMessage(response) {
    try {
        const body = (await response.json());
        if (typeof body.message === "string" && body.message !== "") {
            return body.message;
        }
    }
    catch {
        // 网关/代理插进来的非 JSON 错误页，不猜内容
    }
    return `请求失败（HTTP ${response.status}）`;
}
function writeToken(token) {
    try {
        if (token === null) {
            localStorage.removeItem(TOKEN_KEY);
        }
        else {
            localStorage.setItem(TOKEN_KEY, token);
        }
    }
    catch {
        // 隐私模式下写不进去，那就每次刷新重登一次，不算故障。
    }
}
/** 把 SSE 文本流切成帧。跨 chunk 的半帧必须留到下一次。 */
function createFrameParser(onFrame) {
    let buffer = "";
    return (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            let event = "message";
            const data = [];
            for (const line of frame.split("\n")) {
                if (line.startsWith("event:")) {
                    event = line.slice(6).trim();
                }
                else if (line.startsWith("data:")) {
                    data.push(line.slice(5).trim());
                }
            }
            if (data.length > 0) {
                onFrame(event, data.join("\n"));
            }
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
export function createFetchAdapter(options) {
    const listeners = new Set();
    // 订阅集合属于这条流，sub/unsub 改的就是它。
    let topicSpec = options.topics ?? "";
    let controller;
    let retry = 0;
    let disposed = false;
    const emit = (event) => {
        for (const listener of listeners) {
            listener(event);
        }
    };
    const status = (message, level = "info") => {
        emit({ type: "status", message, level });
    };
    async function connect() {
        if (disposed) {
            return;
        }
        controller?.abort();
        // 每轮持有自己的 Controller：旧轮次被 abort 时，catch 里不能去读那个
        // 已经被换成新轮次的 controller，否则守卫失效、旧轮次会把新连接再 abort 一遍。
        const local = new AbortController();
        controller = local;
        const token = readToken();
        if (token === null) {
            // 没有 token 就不去碰 /events：服务端一定回 401，既不建流也不会有
            // topic 定时器。等 auth 成功后再连，提示直接给，省一个来回。
            status("未登录：执行 auth <user> 登录；help 查看命令", "warn");
            return;
        }
        const query = topicSpec === "" ? "" : `?topics=${encodeURIComponent(topicSpec)}`;
        const headers = { authorization: `Bearer ${token}` };
        try {
            const response = await fetch(`${options.basePath}/events${query}`, {
                headers,
                signal: local.signal,
            });
            if (response.status === 401) {
                // token 过期或无效：清掉，下次打开页面连探测请求都不用发。
                writeToken(null);
                status("未登录：执行 auth <user> 登录；help 查看命令", "warn");
                return;
            }
            if (response.body === null) {
                // 没有正文也可能是网关的异常返回：交给下面的 catch 统一报错并退避重连。
                throw new Error(`empty event stream (HTTP ${response.status})`);
            }
            retry = 0;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const parse = createFrameParser((event, data) => {
                try {
                    if (event === "handshake") {
                        emit({ type: "handshake", info: JSON.parse(data) });
                    }
                    else if (event === "log") {
                        emit({ type: "logs", records: JSON.parse(data) });
                    }
                    else if (event === "topic") {
                        const payload = JSON.parse(data);
                        // 主题读取失败时服务端发的是 { error }，兜一下，别渲染成 "[top] undefined"。
                        emit({ type: "topic", name: payload.name, data: payload.data ?? payload.error });
                    }
                }
                catch {
                    // 单帧解析失败就跳过，没必要整条流重连。
                }
            });
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
                parse(decoder.decode(chunk.value, { stream: true }));
            }
            if (!disposed) {
                status("连接已断开，正在重连…", "warn");
            }
        }
        catch (error) {
            if (disposed || local.signal.aborted) {
                return;
            }
            status(`连接失败：${String(error)}`, "error");
        }
        // 只有这一轮仍是最新时才安排重连：被 abort 的旧轮次不该再拉起一次。
        if (disposed || controller !== local) {
            return;
        }
        // 指数退避，封顶 10 秒：服务重启期间不要把浏览器打死。
        retry += 1;
        setTimeout(() => void connect(), Math.min(10_000, 500 * 2 ** retry));
    }
    return {
        async exec(line) {
            const token = readToken();
            const headers = { "content-type": "application/json" };
            if (token !== null) {
                headers.authorization = `Bearer ${token}`;
            }
            const response = await fetch(`${options.basePath}/exec`, {
                method: "POST",
                headers,
                body: JSON.stringify({ line }),
            });
            if (response.status === 401) {
                writeToken(null);
                status("未登录：执行 auth <user>", "warn");
                return { ok: false, error: "unauthorized", unauthorized: true };
            }
            if (!response.ok) {
                return { ok: false, error: await errorMessage(response) };
            }
            // 成功响应不加壳：命令输出直接在 body.data 里。
            const body = (await response.json());
            return { ok: true, output: body.data };
        },
        async fetchFile(href) {
            const token = readToken();
            const headers = {};
            if (token !== null) {
                headers.authorization = `Bearer ${token}`;
            }
            try {
                const response = await fetch(href, { headers });
                if (response.status === 401) {
                    return { ok: false, error: "未登录：先执行 auth <user>" };
                }
                if (!response.ok) {
                    return { ok: false, error: await errorMessage(response) };
                }
                return { ok: true, text: await response.text() };
            }
            catch (error) {
                return { ok: false, error: String(error) };
            }
        },
        async authenticate(user, password) {
            const response = await fetch(`${options.basePath}/auth`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ user, password }),
            });
            const body = (await response.json());
            if (!response.ok || typeof body.token !== "string") {
                return { ok: false, error: body.message ?? `登录失败（HTTP ${response.status}）` };
            }
            writeToken(body.token);
            // 日志流是鉴权的：拿到 token 立刻重连。
            void connect();
            return { ok: true, user: body.user ?? user };
        },
        setTopics(spec) {
            topicSpec = spec;
            if (listeners.size > 0) {
                void connect();
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
                void connect();
            }
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
