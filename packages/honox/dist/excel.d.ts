/**
 * 拆列的声明，两种写法：
 * - `["equips", "tags"]`：这些列按默认分隔符 `|` 拆；
 * - `{ equips: "|", tags: "," }`：逐列指定分隔符（写 `""` 等同默认）。
 *
 * TS 没有 Go 那样的 struct tag，运行时也没有类型信息，所以分隔符只能这样
 * 跟句柄一起声明——位置就是 `app/md/<名>-template.ts` 里那一行。
 */
export type SplitColumns = readonly string[] | Readonly<Record<string, string>>;
export interface TemplateOptions {
    /**
     * 这些列在读取时拆成 `string[]`。
     *
     * 不拆的话业务侧每次都得自己 `split("|")`，还得处理空单元格；
     * 拆列结果里 `"0"` 保留（它是有含义的占位），空单元格是 `[]`。
     */
    readonly split?: SplitColumns;
}
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
    /** 按 sheet 名取一个 Template 句柄；真正的数据在 load() 之后可读。 */
    template<T extends Record<string, unknown>>(name: string, options?: TemplateOptions): Template<T>;
    /** 按 sheet 名取一个 Config 句柄；真正的数据在 load() 之后可读。 */
    config<T extends Record<string, unknown>>(name: string, options?: TemplateOptions): Config<T>;
}
/**
 * 创建一个元数据管理器。第一个 key 是 sheet 名（`BotTemplate` 这种大写原样），
 * 第二层才是 id——与 rim.server 的 routeTable → templateTable 同构。
 *
 * 用显式实例而不是模块级全局：测试各建一个，互不串状态。
 */
export declare function createMetadata(): Metadata;
