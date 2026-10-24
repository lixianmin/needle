import type { TSchema } from "@sinclair/typebox";
/**
 * 模型类。运行时只用它的 `name` 去注册表里查 schema，实例类型由泛型 `T` 带。
 *
 * `never[]` 而不是 `any[]`：只要 `new () => T` 能赋值给它，具体构造参数无所谓。
 */
export type ModelClass<T = unknown> = abstract new (...args: never[]) => T;
/** 由生成物调用（`registerModel("BotsBody", BotsBodySchema)`）。 */
export declare function registerModel(name: string, schema: TSchema): void;
/**
 * 按类名查 schema。查不到就抛——静默返回 undefined 会让错误变成
 * `undefined is not an object`，离真正的原因隔了十万八千里。
 */
export declare function modelSchema(model: ModelClass): TSchema;
/** 测试用：清空注册表，避免用例之间串味。 */
export declare function clearModels(): void;
//# sourceMappingURL=model.d.ts.map