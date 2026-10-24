export interface SheetOptions {
    /** xlsx 路径；相对路径按 process.cwd() 解析。 */
    file: string;
    /** sheet 名；不给就用文件名去掉扩展名。 */
    sheet?: string;
    /** id 列名，默认 "id"。 */
    id?: string;
}
export interface Sheet<T> {
    readonly name: string;
    get(id: number): T | undefined;
    all(): readonly T[];
    /** 幂等；失败时不留下半加载状态。 */
    load(): Promise<void>;
}
/**
 * 一张 sheet 变成一个类型化、按 id 取数的配置源。
 *
 * 不用类名当 sheet 名：打包压缩后 `constructor.name` 会变成 `e`，
 * 线上就找不到 sheet 了。sheet 名写在参数里，压缩与否都成立。
 */
export declare function defineSheet<T extends Record<string, unknown>>(options: SheetOptions): Sheet<T>;
/** 批量预载：逐个调 `load()`，遇到第一个失败就抛。 */
export declare function loadSheets(sheets: readonly Sheet<unknown>[]): Promise<void>;
