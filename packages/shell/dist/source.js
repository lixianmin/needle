import { createAuth } from "./auth.js";
import { createBuiltinCommands, createHelpCommand } from "./builtins.js";
import { CommandError, findCommand, splitArgs } from "./commands.js";
import { createMetrics } from "./metrics.js";
import { createBroadcast } from "./sse.js";
const DEFAULT_TIMEOUT_MS = 10_000;
/** 指标命令与主题共用一次读取，避免同一秒内重复探测运行时。 */
function createDefaultTopics(metrics) {
    return [
        {
            name: "top",
            note: "进程指标",
            intervalMs: 1000,
            read: () => metrics.read(),
        },
        {
            name: "mem",
            note: "内存与事件循环",
            intervalMs: 5000,
            async read() {
                const snapshot = await metrics.read();
                const { rss, heapUsed, loopUtilization } = snapshot;
                return { rss, heapUsed, loopUtilization };
            },
        },
    ];
}
export function createShellSource(options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const version = options.version ?? "unknown";
    const title = options.title ?? "shell";
    const localUser = options.user ?? null;
    const broadcast = createBroadcast();
    const metrics = createMetrics({ connections: () => broadcast.count() });
    const auth = createAuth(options.auth);
    // 日志推给页面的日志栏；查历史仍然走 log.list。
    options.logger.addSink(broadcast.sink);
    const basePath = options.basePath ?? "";
    const builtins = createBuiltinCommands({
        metrics,
        auth,
        basePath,
        ...(options.logFiles === undefined ? {} : { logFiles: options.logFiles }),
    });
    // 调用方传入的命令优先：内置只是默认值，不是特权层。
    const custom = options.commands ?? [];
    const shadowed = new Set(custom.map((command) => command.name));
    const merged = [
        ...custom,
        // 内置命令打标：help 据此分组，也方便调用方判断某个名字是不是库提供的。
        ...builtins
            .filter((command) => !shadowed.has(command.name))
            .map((command) => ({ ...command, builtin: true })),
    ];
    // help 要列全量（含自定义命令），所以先建空数组再插 —— 让它持有最终引用。
    // 调用方自己定义了 help 就用它的，不硬塞一个内置版本。
    const commands = [];
    // help 是库提供的，跟其他内置命令一样打标——它属于"内置"，不是"自定义"。
    const help = merged.some((command) => command.name === "help")
        ? []
        : [{ ...createHelpCommand(() => commands), builtin: true }];
    commands.push(...help, ...merged);
    const customTopics = options.topics ?? [];
    const shadowedTopics = new Set(customTopics.map((topic) => topic.name));
    const topics = [
        ...customTopics,
        ...createDefaultTopics(metrics).filter((topic) => !shadowedTopics.has(topic.name)),
    ];
    let disposed = false;
    async function exec(line, token) {
        if (disposed)
            return { ok: false, code: "disposed", error: "shell disposed" };
        const [name, ...args] = splitArgs(line);
        if (name === undefined)
            return { ok: false, code: "bad_request", error: "空命令" };
        const command = findCommand(commands, name);
        if (command === undefined) {
            return { ok: false, code: "unknown_command", error: `unknown command: ${name}` };
        }
        let user = localUser;
        if (localUser === null && command.public !== true) {
            const verified = await auth.verify(token);
            if (verified === null)
                return { ok: false, code: "unauthorized", error: "unauthorized" };
            user = verified.sub;
        }
        return runCommand(command, args, user);
    }
    async function runCommand(command, args, user) {
        let timer;
        let timedOut = false;
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => {
                timedOut = true;
                reject(new Error("timeout"));
            }, timeoutMs);
        });
        try {
            const output = await Promise.race([
                Promise.resolve(command.run({ args, user, log: options.logger })),
                deadline,
            ]);
            return { ok: true, output };
        }
        catch (error) {
            if (timedOut)
                return { ok: false, code: "timeout", error: "timeout" };
            // 只回 message：堆栈里有文件路径，是给本地排错用的，不该顺 HTTP 跑出去。
            const message = error instanceof CommandError ? error.message : String(error);
            return { ok: false, code: "command_failed", error: message };
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    return {
        commands,
        topics,
        broadcast,
        ...(options.logFiles === undefined ? {} : { logFiles: options.logFiles }),
        auth,
        title,
        version,
        user: localUser,
        exec,
        async authenticate(user, password) {
            const token = await auth.login(user, password);
            if (token === null)
                return { ok: false, error: "用户名或密码错误" };
            return { ok: true, user, token };
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            broadcast.closeAll();
            options.logger.removeSink(broadcast.sink);
        },
    };
}
