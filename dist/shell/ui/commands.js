function handleAuth(args, ctx) {
    const target = args[0];
    if (target === undefined) {
        ctx.pushText("用法: auth <user>", "status");
        return true;
    }
    ctx.enterPasswordMode(target);
    return true;
}
function handleSub(args, ctx) {
    // 订阅属于那条 SSE 流，未登录时连流都建不起来。
    if (!ctx.state.loggedIn) {
        ctx.pushText("未登录：先执行 auth <user>", "status");
        return true;
    }
    const topic = args[0];
    if (topic === undefined) {
        ctx.pushText(`用法: sub <topic> [interval-ms]，可订阅：${ctx.state.topics.map((item) => item.name).join(" ") || "（无）"}`, "status");
        return true;
    }
    if (ctx.state.topics.length > 0 && !ctx.state.topics.some((item) => item.name === topic)) {
        ctx.pushText(`没有这个主题：${topic}`, "status");
        return true;
    }
    const interval = args[1] === undefined ? undefined : Number(args[1]);
    if (interval !== undefined && !Number.isFinite(interval)) {
        ctx.pushText("interval-ms 必须是数字", "status");
        return true;
    }
    ctx.state.subscriptions.set(topic, interval);
    ctx.applySubscriptions();
    ctx.pushText(`已订阅 ${topic}`, "status");
    return true;
}
function handleUnsub(args, ctx) {
    if (!ctx.state.loggedIn) {
        ctx.pushText("未登录：先执行 auth <user>", "status");
        return true;
    }
    const topic = args[0];
    if (topic === undefined) {
        ctx.state.subscriptions.clear();
        ctx.applySubscriptions();
        ctx.pushText("已取消全部订阅", "status");
        return true;
    }
    if (!ctx.state.subscriptions.delete(topic)) {
        ctx.pushText(`没订阅过 ${topic}`, "status");
        return true;
    }
    ctx.applySubscriptions();
    ctx.pushText(`已取消订阅 ${topic}`, "status");
    return true;
}
/**
 * 本地命令：不发 /exec，因为它们要么属于这条连接，要么属于浏览器。
 *
 * 返回 true 表示这条命令已经处理完了，调用方不要再发服务端。
 */
export function runLocal(name, args, ctx) {
    switch (name) {
        case "auth":
            return handleAuth(args, ctx);
        case "sub":
            return handleSub(args, ctx);
        case "unsub":
            return handleUnsub(args, ctx);
        default:
            return false;
    }
}
export function commonPrefix(values) {
    if (values.length === 0) {
        return "";
    }
    let prefix = values[0] ?? "";
    for (const value of values) {
        while (!value.startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
        }
    }
    return prefix;
}
export function commandNames(prefix, commands) {
    // auth / help 不依赖登录（help 未登录只列这两条），其余命令来自 handshake。
    const names = new Set(["auth", "help", ...commands.map((command) => command.name)]);
    return [...names].filter((name) => name.startsWith(prefix)).sort();
}
export function topicNames(prefix, topics) {
    return topics
        .map((topic) => topic.name)
        .filter((name) => name.startsWith(prefix))
        .sort();
}
/**
 * Tab 补全。
 *
 * 只看行尾补全（控制台里 Tab 基本都在行尾按），这样不用跟 selectionStart
 * 的浏览器差异打交道。命令名来自服务端的 handshake，所以用户在服务器上
 * 自定义的命令一样能被补全；`sub`/`unsub` 的第二个词补主题名。
 */
export function complete(input, options) {
    const tokens = input.value.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? "";
    const pool = tokens.length === 1
        ? commandNames(last, options.commands)
        : tokens[0] === "sub" || tokens[0] === "unsub"
            ? topicNames(last, options.topics)
            : [];
    if (pool.length === 0) {
        return;
    }
    if (pool.length === 1) {
        const before = tokens.slice(0, -1).join(" ");
        input.value = `${before === "" ? "" : `${before} `}${pool[0]} `;
        return;
    }
    const prefix = commonPrefix(pool);
    if (prefix.length > last.length) {
        const before = tokens.slice(0, -1).join(" ");
        input.value = `${before === "" ? "" : `${before} `}${prefix}`;
        return;
    }
    options.pushText(`候选: ${pool.join("  ")}`, "status");
}
