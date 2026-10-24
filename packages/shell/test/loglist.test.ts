import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { ROW_HEIGHT, createLogList } from "../src/ui/loglist.js";

function setup(
  capacity = 20_000,
  measure?: (node: HTMLElement) => number,
  estimate?: (row: number) => number,
) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const list = createLogList<number>(
    doc,
    (value) => {
      const row = doc.createElement("div");
      row.className = "row";
      row.textContent = String(value);
      return row;
    },
    {
      capacity,
      ...(measure === undefined ? {} : { measure }),
      ...(estimate === undefined ? {} : { estimate }),
    },
  );
  doc.body.append(list.el);
  return { doc, list };
}

const rowsOf = (doc: Document): HTMLElement[] =>
  [...doc.querySelectorAll(".row")] as unknown as HTMLElement[];

const scrollTo = (doc: Document, el: HTMLElement, top: number): void => {
  el.scrollTop = top;
  el.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("scroll"));
};

describe("createLogList", () => {
  test("只把可见窗口建进 DOM，缓冲区再大也不影响节点数", () => {
    const { doc, list } = setup();
    list.append(Array.from({ length: 10_000 }, (_, index) => index));
    list.flush();

    const rows = rowsOf(doc);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(120);
    expect((doc.querySelector(".spacer") as unknown as HTMLElement).style.height).toBe(
      `${10_000 * ROW_HEIGHT}px`,
    );
  });

  test("超过容量丢最旧的并计数", () => {
    const { doc, list } = setup(100);
    list.append(Array.from({ length: 150 }, (_, index) => index));
    list.flush();

    expect(list.dropped()).toBe(50);
    expect((doc.querySelector(".spacer") as unknown as HTMLElement).style.height).toBe(
      `${100 * ROW_HEIGHT}px`,
    );

    // 滚回顶部：窗口里第一条是第 50 条（前 50 条被丢掉）
    scrollTo(doc, list.el, 0);
    list.flush();
    const first = rowsOf(doc).sort(
      (a, b) => Number.parseInt(a.style.top, 10) - Number.parseInt(b.style.top, 10),
    )[0];
    expect(first?.textContent).toBe("50");
  });

  test("滚动后渲染对应窗口", () => {
    const { doc, list } = setup();
    list.append(Array.from({ length: 1000 }, (_, index) => index));
    list.flush();

    scrollTo(doc, list.el, 360 * ROW_HEIGHT);
    list.flush();

    const tops = rowsOf(doc).map((row) => Number.parseInt(row.style.top, 10));
    expect(Math.min(...tops)).toBe((360 - 20) * ROW_HEIGHT);
  });

  test("清空后节点与计数都归零", () => {
    const { doc, list } = setup(10);
    list.append(Array.from({ length: 20 }, (_, index) => index));
    list.flush();
    list.clear();
    list.flush();

    expect(rowsOf(doc)).toHaveLength(0);
    expect(list.dropped()).toBe(0);
  });

  test("贴底时保持跟随", () => {
    const { list } = setup();
    list.append([1, 2, 3]);
    expect(list.isFollowing()).toBe(true);
    list.flush();
    list.append([4]);
    expect(list.isFollowing()).toBe(true);
  });
});

describe("变高行", () => {
  test("按行高累加定位，错开的高度不会把后面的行盖住", () => {
    const { doc, list } = setup(
      100,
      (node) => (node.textContent ?? "").length * 10,
      (row) => String(row).length * 10,
    );
    list.append([11, 2222222222, 33]);
    list.flush();

    const topOf = (text: string) =>
      Number.parseInt(rowsOf(doc).find((row) => row.textContent === text)!.style.top, 10);

    expect(topOf("11")).toBe(0);
    expect(topOf("2222222222")).toBe(20);
    expect(topOf("33")).toBe(120);
    expect((doc.querySelector(".spacer") as unknown as HTMLElement).style.height).toBe("140px");
  });

  test("滚动落点按前缀和二分，窗口从落点往前 overscan 行开始", () => {
    const { doc, list } = setup(100, () => 10, () => 10);
    list.append(Array.from({ length: 100 }, (_, index) => index));
    list.flush();

    scrollTo(doc, list.el, 500); // 每行 10px → 落在第 50 条
    list.flush();

    const tops = rowsOf(doc).map((row) => Number.parseInt(row.style.top, 10));
    expect(Math.min(...tops)).toBe(30 * 10);
    expect((doc.querySelector(".spacer") as unknown as HTMLElement).style.height).toBe("1000px");
  });

  test("超过容量丢最旧的，高度也跟着挪", () => {
    const { doc, list } = setup(
      2,
      (node) => (node.textContent ?? "").length * 10,
      (row) => String(row).length * 10,
    );
    list.append([11, 2222222222]);
    list.flush();
    list.append([33]);
    list.flush();

    expect(list.dropped()).toBe(1);
    const topOf = (text: string) =>
      Number.parseInt(rowsOf(doc).find((row) => row.textContent === text)!.style.top, 10);
    expect(topOf("2222222222")).toBe(0);
    expect(topOf("33")).toBe(100);
  });
});
