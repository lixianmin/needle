import type { TSchema } from "@sinclair/typebox";

/**
 * 模型类。运行时只用它的 `name` 去注册表里查 schema，实例类型由泛型 `T` 带。
 *
 * `never[]` 而不是 `any[]`：只要 `new () => T` 能赋值给它，具体构造参数无所谓。
 */
export type ModelClass<T = unknown> = abstract new (...args: never[]) => T;

const registry = new Map<string, TSchema>();

/** 由生成物调用（`registerModel("BotsBody", BotsBodySchema)`）。 */
export function registerModel(name: string, schema: TSchema): void {
  registry.set(name, schema);
}

/**
 * 按类名查 schema。查不到就抛——静默返回 undefined 会让错误变成
 * `undefined is not an object`，离真正的原因隔了十万八千里。
 */
export function modelSchema(model: ModelClass): TSchema {
  const schema = registry.get(model.name);
  if (schema === undefined) {
    throw new Error(
      `没有为 ${model.name} 注册 schema：生成的 *.generated.ts 没有被 import（先 import 那个 bean 文件，示例是 app/beans/bots.js）`,
    );
  }
  return schema;
}

/** 测试用：清空注册表，避免用例之间串味。 */
export function clearModels(): void {
  registry.clear();
}
