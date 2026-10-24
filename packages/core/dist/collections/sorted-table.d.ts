/**
 * 按 key 有序的键值表。移植自 unicorn 的 `SortedTable<TKey, TValue>`
 * （Assets/.../Unicorn/Collections/SortedTable）。
 *
 * 为什么不直接用 Map：需要"始终按 key 有序、能按下标访问、能一次拿到整列"的
 * 场景，Map 就得每次自己排序。这里用两个并行数组（keys / values）维护顺序，
 * 查找走二分，插入时移动数组——跟 C# 原版的取舍完全一致。
 *
 * 复杂度：查找 O(log n)，插入/删除 O(n)（移动数组），按下标访问 O(1)。
 * 适合"读多写少、要顺序遍历"的数据，不适合高频插入的大表。
 */
export type Comparer<K> = (left: K, right: K) => number;
/** 默认比较：数字按大小、字符串按字典序，其余转成字符串再比。 */
export declare function defaultComparer<K>(left: K, right: K): number;
export declare class SortedTable<K, V> implements Iterable<[K, V]> {
    private keys;
    private values;
    private readonly comparer;
    constructor(comparer?: Comparer<K>);
    /** 条目数。 */
    get size(): number;
    /**
     * 二分查找。
     *
     * 找到返回下标；没找到返回 `~插入点`（等于 `-插入点 - 1`）——这是 C# 原版
     * 的做法，调用方据此知道该插到哪儿，不用再搜一遍。
     */
    private search;
    /** 按下标取 key，越界返回 undefined。 */
    keyAt(index: number): K | undefined;
    /** 按下标取值，越界返回 undefined。 */
    valueAt(index: number): V | undefined;
    /** 查找 key 的下标，没有返回 -1。 */
    indexOfKey(key: K): number;
    has(key: K): boolean;
    /** 取值；key 不存在时抛错（与 C# 的索引器一致，区别于 Map.get 返回 undefined）。 */
    get(key: K): V;
    /** 取值；不存在返回 undefined。 */
    tryGet(key: K): V | undefined;
    /** 插入新 key；已存在则抛错（C# 的 Add 语义）。 */
    add(key: K, value: V): void;
    /** 插入或覆盖（C# 的索引器 setter 语义）。 */
    set(key: K, value: V): void;
    remove(key: K): boolean;
    removeAt(index: number): void;
    /** 在指定位置插入，调用方负责保证放进去之后仍然有序。 */
    insertAt(index: number, key: K, value: V): void;
    /**
     * 先追加、最后统一 sort。
     *
     * 批量构建时比逐个 `add` 快：逐个插入每次都要移动数组，追加是 O(1)，
     * 最后一次性排序是 O(n log n)。与 C# 的 `_Append` + `_Sort` 对应。
     */
    append(key: K, value: V): void;
    /** 把整表按 comparer 排序。`append` 之后调用。 */
    sort(): void;
    clear(): void;
    /** key 的有序副本。拿着它遍历不会受后续增删影响。 */
    snapshotKeys(): K[];
    /** value 的有序副本。 */
    snapshotValues(): V[];
    keysIter(): IterableIterator<K>;
    valuesIter(): IterableIterator<V>;
    [Symbol.iterator](): IterableIterator<[K, V]>;
}
