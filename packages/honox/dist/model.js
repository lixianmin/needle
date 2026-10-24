const registry = new Map();
/** 由生成物调用（`registerModel("BotsBody", BotsBodySchema)`）。 */
export function registerModel(name, schema) {
    registry.set(name, schema);
}
/**
 * 按类名查 schema。查不到就抛——静默返回 undefined 会让错误变成
 * `undefined is not an object`，离真正的原因隔了十万八千里。
 */
export function modelSchema(model) {
    const schema = registry.get(model.name);
    if (schema === undefined) {
        throw new Error(`没有为 ${model.name} 注册 schema：生成的 *.generated.ts 没有被 import（先 import 那个 bean 文件，示例是 app/beans/bots.js）`);
    }
    return schema;
}
/** 测试用：清空注册表，避免用例之间串味。 */
export function clearModels() {
    registry.clear();
}
