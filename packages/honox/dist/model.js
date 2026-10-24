const registry = new Map();
/**
 * 由生成物调用（`registerModel("BotsBody", BotsBodySchema)`）。
 *
 * 同名但不同 schema 直接抛：两个 bean 文件都叫 `Body` 时，后注册的会把前一个
 * 静默顶掉，症状是「A 接口按 B 的 schema 校验」，报错里还带着不存在的字段名。
 * 热更新（`bun --hot` 原地重新求值模块）会撞上这道检查，用 `--watch` 重启即可。
 */
export function registerModel(name, schema) {
    const existing = registry.get(name);
    if (existing !== undefined && existing !== schema) {
        throw new Error(`模型重名：${name} 已经注册过另一个 schema（两个 bean 文件用了同一个类名）`);
    }
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
