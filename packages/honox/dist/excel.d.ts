/**
 * 模板类就是 schema：字段默认值写 `[]` 的列会被拆成 `string[]`。
 *
 * TS 的类型在运行时全被擦掉，所以"数组就拆"必须落在运行时可读的地方——
 * 类的字段默认值正好是这样一个地方，写起来又跟 Go 的 struct 一样直白。
 * 逐列换分隔符用静态字段：`static separators = { tags: "," }`。
 */
export type TemplateClass<T extends object> = new () => T;
export interface Template<T> {
    readonly name: string;
    get(id: number): T | undefined;
    all(): readonly T[];
}
export interface Config<T> {
    readonly name: string;
    get(): T;
}
export interface MetadataReport {
    readonly templates: readonly string[];
    readonly configs: readonly string[];
    /** 后缀既不是 Template 也不是 Config 的 sheet，扫描时跳过并在启动日志里列出。 */
    readonly skipped: readonly string[];
}
export interface Metadata {
    /** 扫描 dir（不递归），整体替换已加载的元数据。 */
    load(dir: string): Promise<MetadataReport>;
    /** 用类当 schema：字段默认值是 `[]` 的列按 `|` 拆；sheet 名默认取类名。 */
    template<T extends object>(type: TemplateClass<T>, name?: string): Template<T>;
    /** 不带 schema 的重载：按 sheet 名取，Excel 里的值原样返回。 */
    template<T extends Record<string, unknown>>(name: string): Template<T>;
    /** 用类当 schema 的 Config 句柄。 */
    config<T extends object>(type: TemplateClass<T>, name?: string): Config<T>;
    /** 不带 schema 的重载。 */
    config<T extends Record<string, unknown>>(name: string): Config<T>;
}
/**
 * 创建一个元数据管理器。第一个 key 是 sheet 名（`BotTemplate` 这种大写原样），
 * 第二层才是 id——与 rim.server 的 routeTable → templateTable 同构。
 *
 * 用显式实例而不是模块级全局：测试各建一个，互不串状态。
 */
export declare function createMetadata(): Metadata;
