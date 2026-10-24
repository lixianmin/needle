function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * 环境变量只有字符串；`true/false` 与纯数字要还原成布尔/数字，
 * 否则配置在不同来源下的类型不一致，业务代码得自己再转一遍。
 */
export function coerceValue(raw) {
    if (raw === "true") {
        return true;
    }
    if (raw === "false") {
        return false;
    }
    const trimmed = raw.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
        return Number(trimmed);
    }
    return raw;
}
/**
 * 对象递归合并、数组整体替换——与 rim.proxy 的 `_deepMerge` 同语义。
 * 返回新对象，不改入参：调用方可能共用一份基础配置。
 */
export function deepMerge(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const current = result[key];
        if (isPlainObject(current) && isPlainObject(value)) {
            result[key] = deepMerge(current, value);
            continue;
        }
        result[key] = value;
    }
    return result;
}
/** 按点分路径写值，中间层不存在就建对象。 */
function setPath(target, path, value) {
    let cursor = target;
    for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i];
        if (!isPlainObject(cursor[key])) {
            cursor[key] = {};
        }
        cursor = cursor[key];
    }
    cursor[path[path.length - 1]] = value;
}
/**
 * 环境变量覆盖：`APP_AUTH__SECRET` → `auth.secret`。
 * 用双下划线分隔路径，因为单个下划线在变量名里太常见。
 */
export function applyEnv(base, env, prefix) {
    const result = deepMerge(base, {});
    for (const [key, raw] of Object.entries(env)) {
        if (raw === undefined || !key.startsWith(prefix)) {
            continue;
        }
        const name = key.slice(prefix.length);
        if (name === "") {
            continue;
        }
        setPath(result, name.toLowerCase().split("__"), coerceValue(raw));
    }
    return result;
}
/** 必填项检查：缺失、或值是空字符串，都算没配。 */
export function assertRequired(config, required) {
    const missing = required.filter((path) => {
        let value = config;
        for (const key of path.split(".")) {
            if (!isPlainObject(value) || !(key in value)) {
                return true;
            }
            value = value[key];
        }
        return value === undefined || value === null || value === "";
    });
    if (missing.length > 0) {
        throw new Error(`配置缺少必填项：${missing.join("、")}（来源：config 目录 + 环境变量覆盖）`);
    }
}
/** 配置项不存在，或类型不对。消息里带点分路径，配错时不用翻代码。 */
function missing(path) {
    return new Error(`配置项不存在：${path}`);
}
/** 按点分路径取值；中间层不是对象就当不存在（与 viper 的 Get 语义一致）。 */
export function readPath(data, path) {
    let cursor = data;
    for (const key of path.split(".")) {
        if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
            return undefined;
        }
        cursor = cursor[key];
        if (cursor === undefined) {
            return undefined;
        }
    }
    return cursor;
}
/**
 * 把合并结果包成 viper 风格的取值器：调用方只认 `config.getInt("server.web_port")`，
 * 不再各自去摸 `process.env`，也不用手写一遍点分路径的兼容代码。
 *
 * 取值语义比 viper 严一点：缺值又没给 fallback 就抛。viper 返回零值（"" / 0），
 * 配置写错时表现成「端口 0」「密钥空」，排查成本比报错高得多。
 */
export function createConfig(data, env) {
    function value(path) {
        return readPath(data, path);
    }
    function resolved(path, fallback, convert) {
        const raw = value(path);
        if (raw === undefined) {
            if (fallback !== undefined) {
                return fallback;
            }
            throw missing(path);
        }
        const converted = convert(raw);
        if (converted === undefined) {
            throw new Error(`配置项 ${path} 类型不对：${JSON.stringify(raw)}`);
        }
        return converted;
    }
    return {
        env,
        isDev: () => env === "dev",
        isFat: () => env === "fat",
        isPro: () => env === "pro",
        has: (path) => value(path) !== undefined,
        get: value,
        getString: (path, fallback) => resolved(path, fallback, (raw) => typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
            ? String(raw)
            : undefined),
        getInt: (path, fallback) => resolved(path, fallback, (raw) => {
            if (typeof raw === "number") {
                return Number.isFinite(raw) ? Math.trunc(raw) : undefined;
            }
            if (typeof raw === "string" && raw.trim() !== "") {
                const parsed = Number(raw);
                return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
            }
            return undefined;
        }),
        getBool: (path, fallback) => resolved(path, fallback, (raw) => {
            if (typeof raw === "boolean") {
                return raw;
            }
            if (raw === "true") {
                return true;
            }
            if (raw === "false") {
                return false;
            }
            return undefined;
        }),
        getStringMap: (path) => {
            const raw = value(path);
            if (raw === undefined) {
                return {};
            }
            if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
                throw new Error(`配置项 ${path} 不是 key→value 映射：${JSON.stringify(raw)}`);
            }
            const map = {};
            for (const [key, entry] of Object.entries(raw)) {
                map[key] = String(entry);
            }
            return map;
        },
        raw: () => data,
    };
}
