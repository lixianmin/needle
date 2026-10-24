import { Value } from "@sinclair/typebox/value";
import { RequestError } from "./request.js";
/** schema 声明的字段名 → 该字段是不是数组（重复键要收集全部值）。 */
function arrayKeysOf(schema) {
    const properties = schema.properties ?? {};
    return new Set(Object.entries(properties)
        .filter(([, member]) => member.type === "array")
        .map(([key]) => key));
}
function declaredKeysOf(schema) {
    const properties = schema.properties ?? {};
    return new Set(Object.keys(properties));
}
/** 首个错误 + 其余数量：message 只留摘要，完整列表在 TypeBox 侧还能再取。 */
function messageOf(label, errors) {
    const first = errors[0];
    if (first === undefined) {
        return `${label} 不合法`;
    }
    const where = first.path === "" ? "/" : first.path;
    const rest = errors.length - 1;
    return `${label} ${where} ${first.message}${rest > 0 ? `（另有 ${rest} 处）` : ""}`;
}
function assert(label, schema, value) {
    const errors = [...Value.Errors(schema, value)];
    if (errors.length > 0) {
        throw new RequestError(400, "bad_request", messageOf(label, errors));
    }
    return value;
}
/**
 * 解析 JSON body 并按 schema 校验。
 *
 * **不做类型转换**：`Value.Parse` / `Value.Convert` 会把 `true` 变成 `1`，
 * 那是替客户端掩饰 bug 的口子，所以这里只用 `Value.Errors` 严格判。
 */
export async function parseBody(c, schema) {
    let parsed;
    try {
        parsed = await c.req.json();
    }
    catch (error) {
        // 只有 JSON 语法错才是客户端的锅。流已经被读过（比如前面的中间件为了校验
        // 签名先读了 `c.req.raw`）属于接线错误，必须原样抛——否则它会被记成 400，
        // 而 RequestError 又不写 error 日志，服务端的 bug 就此彻底隐身。
        if (!(error instanceof SyntaxError)) {
            throw error;
        }
        throw new RequestError(400, "bad_request", "body 不是合法 JSON");
    }
    if (typeof parsed === "object" && parsed !== null) {
        // 就地补默认值：`c.req.json()` 出来的对象是本次请求独占的，改它没有副作用。
        Value.Default(schema, parsed);
    }
    return assert("body", schema, parsed);
}
/**
 * 解析 query 并按 schema 校验。
 *
 * 规则（对外行为，改动即 breaking）：
 * - 只认 schema 声明的键，其它（`_t` 之类）直接忽略；
 * - 空串视为未传：`?id=` 不该变成 `0`；
 * - schema 里该键是数组时收集全部重复值，否则取最后一个。
 */
export function parseQuery(c, schema) {
    const declared = declaredKeysOf(schema);
    const arrays = arrayKeysOf(schema);
    const raw = {};
    for (const [key, values] of Object.entries(c.req.queries())) {
        if (!declared.has(key)) {
            continue;
        }
        const kept = values.filter((value) => value !== "");
        if (kept.length === 0) {
            continue;
        }
        raw[key] = arrays.has(key) ? kept : kept[kept.length - 1];
    }
    // query 全是字符串，必须转换；`"abc"` 转不动会留在原地，随后被 Errors 拦下。
    const converted = Value.Convert(schema, raw);
    Value.Default(schema, converted);
    return assert("query", schema, converted);
}
