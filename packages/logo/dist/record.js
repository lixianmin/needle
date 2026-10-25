/** 循环引用的替身。JSON 里看到一个字符串，比整条日志丢掉要好。 */
const CIRCULAR = "[Circular]";
/** 超过这个深度就不再下钻。日志不是数据库，深到 8 层的数据多半是误传。 */
const MAX_DEPTH = 8;
/**
 * 一次序列化最多展开多少个对象。
 *
 * 去环按"当前路径"判断后，同一个对象在兄弟字段里会被各展开一次——这是正确
 * 语义，但 8 层、每层 4 个共享引用的数据就是 4^8 个节点。一万个节点足够描述
 * 任何真实日志对象，再多的多半是误传，标 [Truncated] 比卡住事件循环好。
 */
const MAX_NODES = 10_000;
/**
 * 把任意值变成 JSON 安全的副本。
 *
 * 存在的理由：`buildRecord` 收到的对象会原样挂在记录上，而记录最终要被
 * `JSON.stringify`。如果调用方传了循环引用、BigInt、或者抛异常的 getter，
 * 序列化会失败——而那通常发生在进程崩溃前的最后一条日志上，正好是最不能丢的一条。
 *
 * 代价是每次写日志多一次遍历。日志对象通常很小，这个代价远小于丢日志的风险。
 */
export function sanitize(value, depth = 0, ancestors = new WeakSet(), budget = { nodes: MAX_NODES }) {
    // 函数不是对象，但旧实现把判断放在早退之后，于是函数值原样进了记录。
    if (typeof value === "function") {
        return "[Function]";
    }
    if (value === null || typeof value !== "object") {
        // BigInt 不能进 JSON，转成字符串保住精度。
        return typeof value === "bigint" ? value.toString() : value;
    }
    if (depth >= MAX_DEPTH) {
        return "[Depth]";
    }
    if (budget.nodes <= 0) {
        return "[Truncated]";
    }
    budget.nodes -= 1;
    // 只沿当前路径去环：`{ start: d, end: d }` 是共享引用，不是环。旧实现用
    // 一个贯穿整次遍历的 WeakSet，第二个 d 就被误判成 "[Circular]"。
    if (ancestors.has(value)) {
        return CIRCULAR;
    }
    ancestors.add(value);
    try {
        if (value instanceof Error) {
            return { message: value.message, stack: value.stack };
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (Array.isArray(value)) {
            return value.map((item) => sanitize(item, depth + 1, ancestors, budget));
        }
        // Map / Set / Headers / URLSearchParams 的自有可枚举键是空的，走下面的
        // Object.keys 会变成 `{}`——日志里只剩一个空对象，且不像函数、环、超深那样
        // 带标记，读的人会以为真的没有内容。按内容摊开，与数组同口径。
        if (value instanceof Map) {
            return Object.fromEntries([...value.entries()].map(([key, item]) => [
                typeof key === "string" ? key : String(sanitize(key, depth + 1, ancestors, budget)),
                sanitize(item, depth + 1, ancestors, budget),
            ]));
        }
        if (value instanceof Set) {
            return [...value.values()].map((item) => sanitize(item, depth + 1, ancestors, budget));
        }
        if (value instanceof URLSearchParams || (typeof Headers !== "undefined" && value instanceof Headers)) {
            return Object.fromEntries([...value.entries()].map(([key, item]) => [
                key,
                sanitize(item, depth + 1, ancestors, budget),
            ]));
        }
        const copy = {};
        let keys;
        try {
            // Object.keys 不会触发 getter，先把键取完再逐个取值，单字段出错不影响其余字段。
            keys = Object.keys(value);
        }
        catch {
            return "[Throws]";
        }
        for (const key of keys) {
            try {
                copy[key] = sanitize(value[key], depth + 1, ancestors, budget);
            }
            catch {
                // getter 抛异常。一条坏字段不该毁掉整条日志。
                copy[key] = "[Throws]";
            }
        }
        return copy;
    }
    finally {
        ancestors.delete(value);
    }
}
/** 序列化成字符串，失败时退回 `String(value)`。序列化本身永不抛。 */
export function safeStringify(value) {
    try {
        const text = JSON.stringify(sanitize(value));
        return text === undefined ? String(value) : text;
    }
    catch {
        return String(value);
    }
}
/** 只有"纯对象"才合并进记录字段；数组、Date、类实例都当作值渲染进 msg。 */
function isPlainObject(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
/** 这几个键由信封填写，业务数据不允许碰。 */
const ENVELOPE_FIELDS = new Set(["time", "level", "msg", "name"]);
/**
 * 把 sanitize 过的业务字段并进记录，信封字段一律跳过。
 *
 * `source` 永远是 `sanitize` 的产出（一个字面量 `{}` 拷贝或 `{message, stack}`），
 * 所以 `for...in` 只会拿到自有可枚举键。
 */
function mergeFields(out, source) {
    for (const key in source) {
        if (ENVELOPE_FIELDS.has(key)) {
            continue;
        }
        out[key] = source[key];
    }
}
/**
 * 把一次调用的参数变成一条记录。
 *
 * 规则只有三条，因为规则多了没人记得住：
 *   1. 纯对象合并进字段（对象是数据）
 *   2. Error 展开成 message + stack
 *   3. 其余一切拼成 msg（用空格分隔，与 console 一致）
 *
 * 信封字段（time/level/msg/name/site/fn/stack）最后写入，因此永远压过同名业务字段。
 *
 * 业务字段是“拷贝时跳过信封键”，不是“先 Object.assign 再 delete”：delete 会把对象
 * 打到字典模式，改完还得再 `{...fields}` 展开一次。改掉之后一条日志 293 → 211 ns，
 * 语义不变（信封字段照样拦得住）。
 */
export function buildRecord(level, args, options = {}) {
    const record = {};
    const parts = [];
    for (const arg of args) {
        if (arg instanceof Error) {
            mergeFields(record, sanitize(arg));
        }
        else if (isPlainObject(arg)) {
            mergeFields(record, sanitize(arg));
        }
        else if (arg === null || typeof arg !== "object") {
            parts.push(String(arg));
        }
        else {
            parts.push(safeStringify(arg));
        }
    }
    // 信封字段由库拥有，业务对象里的同名键已经在 mergeFields 里丢掉——否则调用方能用
    // `info({ level: "error" })` 伪造级别，过滤和告警都跟着跑偏。
    record.time = options.time ?? Date.now();
    record.level = level;
    const msg = parts.join(" ");
    if (msg !== "") {
        record.msg = msg;
    }
    if (options.name !== undefined) {
        record.name = options.name;
    }
    // 调用方显式给的 site / fn 优先：请求日志要把位置标成"哪个 API 文件"
    // （那一刻真实栈上是中间件，自动抓到的永远是中间件那一行）。
    if (options.site !== undefined && record.site === undefined) {
        record.site = options.site;
    }
    if (options.fn !== undefined && record.fn === undefined) {
        record.fn = options.fn;
    }
    // 参数里的 Error 自带调用栈（抛出点），比这里的调用点更准，优先保留。
    if (options.stack !== undefined && record.stack === undefined) {
        record.stack = options.stack;
    }
    return record;
}
