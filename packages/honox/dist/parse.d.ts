import type { TSchema } from "@sinclair/typebox";
import type { Context } from "hono";
import type { HonoxEnv } from "./types.js";
/**
 * 解析 JSON body 并按 schema 校验。
 *
 * **不做类型转换**：`Value.Parse` / `Value.Convert` 会把 `true` 变成 `1`，
 * 那是替客户端掩饰 bug 的口子，所以这里只用 `Value.Errors` 严格判。
 */
export declare function parseBody<T extends TSchema>(ctx: Context<HonoxEnv>, schema: T): Promise<T["static"]>;
/**
 * 解析 query 并按 schema 校验。
 *
 * 规则（对外行为，改动即 breaking）：
 * - 只认 schema 声明的键，其它（`_t` 之类）直接忽略；
 * - 空串视为未传：`?id=` 不该变成 `0`；
 * - schema 里该键是数组时收集全部重复值，否则取最后一个。
 */
export declare function parseQuery<T extends TSchema>(ctx: Context<HonoxEnv>, schema: T): T["static"];
//# sourceMappingURL=parse.d.ts.map