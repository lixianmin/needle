import { describe, expect, test } from "bun:test";

import { table } from "../../packages/shell/src/table.js";
import type { LinkedCell } from "../../packages/shell/src/types.js";

const io = table<{ path: string; reads: number; bytes: number; hitRate: number }>({
  path: {},
  reads: { format: "number" },
  bytes: { format: "bytes", title: "size" },
  hitRate: { format: "number" },
});

describe("table()", () => {
  test("列顺序来自 schema，行对象按 key 取值", () => {
    const output = io.output([{ hitRate: 0.982, bytes: 3_600_000, path: "/api/user", reads: 1520 }]);
    if (output.kind !== "table") throw new Error("应该是 table");
    expect(output.columns).toEqual(["path", "reads", "size", "hitRate"]);
    expect(output.rows).toEqual([["/api/user", 1520, 3_600_000, 0.982]]);
    expect(output.formats).toEqual(["auto", "number", "bytes", "number"]);
  });

  test("没有行时列还在（空结果也能画出表头）", () => {
    const output = io.output([]);
    if (output.kind !== "table") throw new Error("应该是 table");
    expect(output.columns).toEqual(["path", "reads", "size", "hitRate"]);
    expect(output.rows).toEqual([]);
  });

  test("链接单元格原样透传", () => {
    const files = table<{ file: LinkedCell; size: number }>({ file: {}, size: { format: "bytes" } });
    const link = { text: "info.log", href: "/shell/log/info.log" };
    const output = files.output([{ file: link, size: 18 }]);
    if (output.kind !== "table") throw new Error("应该是 table");
    expect(output.rows[0]?.[0]).toEqual(link);
  });
});
