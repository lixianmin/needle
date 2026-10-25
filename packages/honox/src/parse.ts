import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import type { Context } from "hono";
import { RequestError } from "./request.js";
import type { HonoxEnv } from "./types.js";

/** schema 声明的字段名 → 该字段是不是数组（重复键要收集全部值）。 */
function arrayKeysOf(schema: TSchema): ReadonlySet<string> {
  const properties = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
  return new Set(
    Object.entries(properties)
      .filter(([, member]) => member.type === "array")
      .map(([key]) => key),
  );
}

function declaredKeysOf(schema: TSchema): ReadonlySet<string> {
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
  return new Set(Object.keys(properties));
}

/** 首个错误 + 其余数量：message 只留摘要，完整列表在 TypeBox 侧还能再取。 */
function messageOf(label: string, errors: readonly { path: string; message: string }[]): string {
  const first = errors[0];
  // assert 只在有错时调用本函数，所以 errors 肯定非空；下面两个分支走不到，留着只是给
  // noUncheckedIndexedAccess 收窄类型。
  // Stryker disable next-line ConditionalExpression,BlockStatement
  if (first === undefined) {
    // Stryker disable next-line StringLiteral
    return `${label} 不合法`;
  }

  const where = first.path === "" ? "/" : first.path;
  const rest = errors.length - 1;
  return `${label} ${where} ${first.message}${rest > 0 ? `（另有 ${rest} 处）` : ""}`;
}

function assert<T extends TSchema>(label: string, schema: T, value: unknown): T["static"] {
  const errors = [...Value.Errors(schema, value)];
  if (errors.length > 0) {
    throw new RequestError(400, "bad_request", messageOf(label, errors));
  }

  return value as T["static"];
}

/**
 * 解析 JSON body 并按 schema 校验。
 *
 * **不做类型转换**：`Value.Parse` / `Value.Convert` 会把 `true` 变成 `1`，
 * 那是替客户端掩饰 bug 的口子，所以这里只用 `Value.Errors` 严格判。
 */
export async function parseBody<T extends TSchema>(ctx: Context<HonoxEnv>, schema: T) {
  let parsed: unknown;
  try {
    parsed = await ctx.req.json();
  } catch (error) {
    // 只有 JSON 语法错才是客户端的锅。流已经被读过（比如前面的中间件为了校验
    // 签名先读了 `ctx.req.raw`）属于接线错误，必须原样抛——否则它会被记成 400，
    // 而 RequestError 又不写 error 日志，服务端的 bug 就此彻底隐身。
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    throw new RequestError(400, "bad_request", "body 不是合法 JSON");
  }

  // Stryker disable next-line ConditionalExpression,LogicalOperator: TypeBox 的 Value.Default 对 null / 标量是 no-op，这层护栏不改变可观测行为
  if (typeof parsed === "object" && parsed !== null) {
    // 就地补默认值：`ctx.req.json()` 出来的对象是本次请求独占的，改它没有副作用。
    Value.Default(schema, parsed as Record<string, unknown>);
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
export function parseQuery<T extends TSchema>(ctx: Context<HonoxEnv>, schema: T) {
  const declared = declaredKeysOf(schema);
  const arrays = arrayKeysOf(schema);
  const raw: Record<string, unknown> = {};

  for (const [key, values] of Object.entries(ctx.req.queries())) {
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
  Value.Default(schema, converted as Record<string, unknown>);
  return assert("query", schema, converted);
}
