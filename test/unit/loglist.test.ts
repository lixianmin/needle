import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { ROW_HEIGHT, createLogList } from "../../packages/shell/src/ui/loglist.js";

function setup(capacity = 20_000, onSelect?: (row: number | undefined) => void) {
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
    { capacity, onSelect },
  );
  doc.body.append(list.el);
  return { doc, list };
}

const rowsOf = (doc: Document): HTMLElement[] =>
  [...doc.querySelectorAll(".row")] as unknown as HTMLElement[];

const click = (row: HTMLElement): void => {
  row.click();
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
    list.el.scrollTop = 0;
    list.el.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("scroll"));
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

    list.el.scrollTop = 360 * ROW_HEIGHT;
    list.el.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("scroll"));
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

describe("选中一行看详情", () => {
  test("点一下选中，再点一下取消", () => {
    const picked: (number | undefined)[] = [];
    const { doc, list } = setup(100, (row) => picked.push(row));
    list.append([11, 22, 33]);
    list.flush();

    const rows = rowsOf(doc).sort(
      (a, b) => Number.parseInt(a.style.top, 10) - Number.parseInt(b.style.top, 10),
    );
    click(rows[1] as HTMLElement);
    expect(picked).toEqual([22]);
    expect((rows[1] as HTMLElement).classList.contains("on")).toBe(true);

    click(rows[1] as HTMLElement);
    expect(picked).toEqual([22, undefined]);
    expect((rows[1] as HTMLElement).classList.contains("on")).toBe(false);
  });

  test("丢弃旧记录时选中项跟着下移，被丢掉了就清空", () => {
    const picked: (number | undefined)[] = [];
    const { doc, list } = setup(5, (row) => picked.push(row));
    list.append([1, 2, 3, 4, 5]);
    list.flush();

    const at = (index: number): HTMLElement => {
      const rows = rowsOf(doc).sort(
        (a, b) => Number.parseInt(a.style.top, 10) - Number.parseInt(b.style.top, 10),
      );
      return rows[index] as HTMLElement;
    };

    click(at(3)); // 选中 4
    list.append([6, 7, 8]); // 丢 1 2 3，4 变成第 0 条
    list.flush();
    expect(at(0).textContent).toBe("4");
    expect(at(0).classList.contains("on")).toBe(true);

    list.append([9, 10, 11, 12, 13]); // 选中项 4 也被丢掉
    list.flush();
    expect(picked.at(-1)).toBeUndefined();
    expect(rowsOf(doc).some((row) => row.classList.contains("on"))).toBe(false);
  });
});
