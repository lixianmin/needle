import { describe, expect, test } from "bun:test";

import { SortedTable } from "../../src/core/collections/sorted-table.js";

describe("SortedTable", () => {
  test("乱序插入，遍历时按 key 有序", () => {
    const table = new SortedTable<number, string>();
    for (const key of [5, 1, 9, 3, 7]) table.add(key, `v${key}`);

    expect([...table.keysIter()]).toEqual([1, 3, 5, 7, 9]);
    expect([...table].map(([key]) => key)).toEqual([1, 3, 5, 7, 9]);
  });

  test("重复 key 的 add 抛错，set 则覆盖", () => {
    const table = new SortedTable<string, number>();
    table.add("a", 1);

    expect(() => table.add("a", 2)).toThrow(/重复/);
    table.set("a", 3);
    expect(table.get("a")).toBe(3);
    expect(table.size).toBe(1);
  });

  test("set 新 key 会插到正确位置", () => {
    const table = new SortedTable<number, string>();
    table.add(10, "ten");
    table.set(5, "five");

    expect([...table.keysIter()]).toEqual([5, 10]);
  });

  test("get 缺 key 抛错，tryGet 返回 undefined", () => {
    const table = new SortedTable<string, string>();
    table.add("a", "1");

    expect(() => table.get("zzz")).toThrow(/不存在/);
    expect(table.tryGet("zzz")).toBeUndefined();
  });

  test("indexOfKey 命中返回下标，未命中返回 -1", () => {
    const table = new SortedTable<number, string>();
    for (const key of [2, 4, 6]) table.add(key, String(key));

    expect(table.indexOfKey(4)).toBe(1);
    expect(table.indexOfKey(5)).toBe(-1);
  });

  test("remove / removeAt 保持其余顺序", () => {
    const table = new SortedTable<number, string>();
    for (const key of [1, 2, 3]) table.add(key, String(key));

    expect(table.remove(2)).toBe(true);
    expect(table.remove(99)).toBe(false);

    table.removeAt(0);
    expect([...table.keysIter()]).toEqual([3]);
  });

  test("append + sort 批量构建", () => {
    const table = new SortedTable<number, string>();
    table.append(3, "c");
    table.append(1, "a");
    table.append(2, "b");
    table.sort();

    expect([...table.keysIter()]).toEqual([1, 2, 3]);
    expect([...table.valuesIter()]).toEqual(["a", "b", "c"]);
  });

  test("自定义 comparer（倒序）", () => {
    const table = new SortedTable<number, string>((left, right) => right - left);
    for (const key of [1, 3, 2]) table.add(key, String(key));

    expect([...table.keysIter()]).toEqual([3, 2, 1]);
  });

  test("snapshot 不受后续修改影响", () => {
    const table = new SortedTable<number, string>();
    table.add(1, "a");

    const keys = table.snapshotKeys();
    table.add(2, "b");

    expect(keys).toEqual([1]);
    expect([...table.keysIter()]).toEqual([1, 2]);
  });

  test("按下标访问", () => {
    const table = new SortedTable<string, number>();
    table.add("b", 2);
    table.add("a", 1);

    expect(table.keyAt(0)).toBe("a");
    expect(table.valueAt(1)).toBe(2);
    expect(table.keyAt(9)).toBeUndefined();
  });

  test("clear 之后为空", () => {
    const table = new SortedTable<number, number>();
    table.add(1, 1);
    table.clear();

    expect(table.size).toBe(0);
    expect([...table]).toEqual([]);
  });

  test("大量乱序插入仍然有序", () => {
    const table = new SortedTable<number, number>();
    const input = Array.from({ length: 500 }, (_, i) => (i * 37) % 500);
    for (const key of input) table.add(key, key);

    const keys = [...table.keysIter()];
    expect(keys).toHaveLength(500);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });
});
