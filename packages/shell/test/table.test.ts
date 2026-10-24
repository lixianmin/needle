import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { table } from "../src/table.js";
import { createTableRenderer } from "../src/ui/table.js";
import type { LinkedCell } from "../src/types.js";

const io = table<{ path: string; reads: number; bytes: number; hitRate: number }>({
  path: {},
  reads: { format: "number" },
  bytes: { format: "bytes", title: "size" },
  hitRate: { format: "number" },
});

describe("table()", () => {
  test("列顺序来自 schema，行对象按 key 取值", () => {
    const output = io.output([{ hitRate: 0.982, bytes: 3_600_000, path: "/api/user", reads: 1520 }]);
    if (output.kind !== "table") {
      throw new Error("应该是 table");
    }
    expect(output.columns).toEqual(["path", "reads", "size", "hitRate"]);
    expect(output.rows).toEqual([["/api/user", 1520, 3_600_000, 0.982]]);
    expect(output.formats).toEqual(["auto", "number", "bytes", "number"]);
  });

  test("没有行时列还在（空结果也能画出表头）", () => {
    const output = io.output([]);
    if (output.kind !== "table") {
      throw new Error("应该是 table");
    }
    expect(output.columns).toEqual(["path", "reads", "size", "hitRate"]);
    expect(output.rows).toEqual([]);
  });

  test("链接单元格原样透传", () => {
    const files = table<{ file: LinkedCell; size: number }>({ file: {}, size: { format: "bytes" } });
    const link = { text: "info.log", href: "/shell/log/info.log" };
    const output = files.output([{ file: link, size: 18 }]);
    if (output.kind !== "table") {
      throw new Error("应该是 table");
    }
    expect(output.rows[0]?.[0]).toEqual(link);
  });
});

describe("表格渲染：tip", () => {
  test("带 tip 的链接渲染 tips_text，纯文本不解析 HTML", () => {
    const doc = new Window().document as unknown as Document;
    const render = createTableRenderer(doc, () => {});
    const grid = render(["file"], [
      [{ text: "info.log", href: "/log/info.log", tip: "<script>alert(1)</script>\n第二行" }],
    ]);

    // 样本是纯文本：日志内容里的 <script> 不能变成元素（GONSOLE 修过的 XSS）
    const tip = grid.querySelector(".tips_text");
    expect(tip?.textContent).toBe("<script>alert(1)</script>\n第二行");
    expect(tip?.querySelector("script")).toBeNull();
    expect(grid.querySelector("script")).toBeNull();
    expect(grid.querySelector(".tips")).not.toBeNull();
    const link = grid.querySelector("a");
    expect(link?.textContent).toBe("info.log");
  });

  test("无 tip 的链接不包 tips 容器", () => {
    const doc = new Window().document as unknown as Document;
    const render = createTableRenderer(doc, () => {});
    const grid = render(["file"], [[{ text: "info.log", href: "/log/info.log" }]]);

    expect(grid.querySelector(".tips")).toBeNull();
    expect(grid.querySelector(".tips_text")).toBeNull();
    expect(grid.querySelector("a")).not.toBeNull();
  });
});
