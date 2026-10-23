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
/** 默认比较：数字按大小、字符串按字典序，其余转成字符串再比。 */
export function defaultComparer(left, right) {
    const leftType = typeof left;
    const rightType = typeof right;
    // 类型不同就不能转字符串比：`1` 与 `"1"` 会被判成相等，set() 静默覆盖前一个值。
    if (leftType !== rightType)
        return leftType < rightType ? -1 : 1;
    if (leftType === "number")
        return left - right;
    if (leftType === "string")
        return left < right ? -1 : left > right ? 1 : 0;
    const a = String(left);
    const b = String(right);
    return a < b ? -1 : a > b ? 1 : 0;
}
export class SortedTable {
    keys = [];
    values = [];
    comparer;
    constructor(comparer = defaultComparer) {
        this.comparer = comparer;
    }
    /** 条目数。 */
    get size() {
        return this.keys.length;
    }
    /**
     * 二分查找。
     *
     * 找到返回下标；没找到返回 `~插入点`（等于 `-插入点 - 1`）——这是 C# 原版
     * 的做法，调用方据此知道该插到哪儿，不用再搜一遍。
     */
    search(key) {
        let low = 0;
        let high = this.keys.length - 1;
        while (low <= high) {
            const mid = (low + high) >>> 1;
            const order = this.comparer(this.keys[mid], key);
            if (order < 0)
                low = mid + 1;
            else if (order > 0)
                high = mid - 1;
            else
                return mid;
        }
        return ~low;
    }
    /** 按下标取 key，越界返回 undefined。 */
    keyAt(index) {
        return this.keys[index];
    }
    /** 按下标取值，越界返回 undefined。 */
    valueAt(index) {
        return this.values[index];
    }
    /** 查找 key 的下标，没有返回 -1。 */
    indexOfKey(key) {
        const index = this.search(key);
        return index >= 0 ? index : -1;
    }
    has(key) {
        return this.search(key) >= 0;
    }
    /** 取值；key 不存在时抛错（与 C# 的索引器一致，区别于 Map.get 返回 undefined）。 */
    get(key) {
        const index = this.search(key);
        if (index < 0)
            throw new Error(`SortedTable: key 不存在 ${String(key)}`);
        return this.values[index];
    }
    /** 取值；不存在返回 undefined。 */
    tryGet(key) {
        const index = this.search(key);
        return index >= 0 ? this.values[index] : undefined;
    }
    /** 插入新 key；已存在则抛错（C# 的 Add 语义）。 */
    add(key, value) {
        const index = this.search(key);
        if (index >= 0)
            throw new Error(`SortedTable: key 重复 ${String(key)}`);
        this.insertAt(~index, key, value);
    }
    /** 插入或覆盖（C# 的索引器 setter 语义）。 */
    set(key, value) {
        const index = this.search(key);
        if (index >= 0) {
            this.values[index] = value;
            return;
        }
        this.insertAt(~index, key, value);
    }
    remove(key) {
        const index = this.search(key);
        if (index < 0)
            return false;
        this.removeAt(index);
        return true;
    }
    removeAt(index) {
        if (index < 0 || index >= this.keys.length)
            throw new RangeError("SortedTable: 下标越界");
        this.keys.splice(index, 1);
        this.values.splice(index, 1);
    }
    /** 在指定位置插入，调用方负责保证放进去之后仍然有序。 */
    insertAt(index, key, value) {
        if (index < 0 || index > this.keys.length)
            throw new RangeError("SortedTable: 插入位置越界");
        this.keys.splice(index, 0, key);
        this.values.splice(index, 0, value);
    }
    /**
     * 先追加、最后统一 sort。
     *
     * 批量构建时比逐个 `add` 快：逐个插入每次都要移动数组，追加是 O(1)，
     * 最后一次性排序是 O(n log n)。与 C# 的 `_Append` + `_Sort` 对应。
     */
    append(key, value) {
        this.keys.push(key);
        this.values.push(value);
    }
    /** 把整表按 comparer 排序。`append` 之后调用。 */
    sort() {
        const pairs = this.keys.map((key, index) => [key, this.values[index]]);
        pairs.sort((left, right) => this.comparer(left[0], right[0]));
        for (let i = 0; i < pairs.length; i += 1) {
            const [key, value] = pairs[i];
            this.keys[i] = key;
            this.values[i] = value;
        }
    }
    clear() {
        this.keys.length = 0;
        this.values.length = 0;
    }
    /** key 的有序副本。拿着它遍历不会受后续增删影响。 */
    snapshotKeys() {
        return [...this.keys];
    }
    /** value 的有序副本。 */
    snapshotValues() {
        return [...this.values];
    }
    *keysIter() {
        yield* this.keys;
    }
    *valuesIter() {
        yield* this.values;
    }
    *[Symbol.iterator]() {
        for (let i = 0; i < this.keys.length; i += 1) {
            yield [this.keys[i], this.values[i]];
        }
    }
}
