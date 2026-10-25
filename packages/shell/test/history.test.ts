import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { readHistory, writeHistory } from "../src/ui/history.js";

const HISTORY_KEY = "logo.shell.history";

beforeEach(() => {
  const window = new Window({ url: "http://localhost/" });
  (globalThis as unknown as { localStorage: Storage }).localStorage = window.localStorage as unknown as Storage;
});

describe("命令历史", () => {
  test("没有历史时返回空数组", () => {
    expect(readHistory()).toEqual([]);
  });

  test("坏 JSON、非数组都退成空数组", () => {
    localStorage.setItem(HISTORY_KEY, "not json");
    expect(readHistory()).toEqual([]);

    localStorage.setItem(HISTORY_KEY, JSON.stringify({ a: 1 }));
    expect(readHistory()).toEqual([]);
  });

  test("非字符串项被过滤", () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(["a", 1, "b"]));
    expect(readHistory()).toEqual(["a", "b"]);
  });

  test("只留最近 50 条", () => {
    writeHistory(Array.from({ length: 60 }, (_unused, index) => `cmd${index}`));

    const saved = readHistory();
    expect(saved).toHaveLength(50);
    expect(saved[0]).toBe("cmd10");
  });

  test("写不进去（隐私模式）时不抛", () => {
    const real = globalThis.localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      setItem() {
        throw new Error("denied");
      },
    } as unknown as Storage;

    expect(() => {
      writeHistory(["a"]);
    }).not.toThrow();

    (globalThis as unknown as { localStorage: Storage }).localStorage = real;
  });
});
