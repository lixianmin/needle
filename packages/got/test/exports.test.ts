import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 包根：test/ 的上一级就是 packages/got。 */
const PKG = join(import.meta.dir, "..");

describe("@needle/got 的导出映射", () => {
  test("只有一个入口，且指向真实存在的 dist 文件", () => {
    const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, { types: string; default: string }>;
    };

    expect(pkg.name).toBe("@needle/got");
    expect(Object.keys(pkg.exports)).toEqual(["."]);

    for (const entry of Object.values(pkg.exports)) {
      expect(entry.default.startsWith("./dist/")).toBe(true);
      readFileSync(join(PKG, entry.default));
      readFileSync(join(PKG, entry.types));
    }
  });

  test("按包名能拿到 SortedTable", async () => {
    const got = await import("@needle/got");
    expect(typeof got.SortedTable).toBe("function");
    expect(typeof got.defaultComparer).toBe("function");
  });
});
