import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 包根：test/ 的上一级就是 packages/honox。 */
const PKG = join(import.meta.dir, "..");

describe("@needle/honox 的导出映射", () => {
  test("每个 exports 入口都指向真实存在的 dist 文件", () => {
    const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, { types: string; default: string }>;
    };

    expect(pkg.name).toBe("@needle/honox");

    for (const entry of Object.values(pkg.exports)) {
      expect(entry.default.startsWith("./dist/")).toBe(true);
      expect(entry.types.startsWith("./dist/")).toBe(true);
      readFileSync(join(PKG, entry.default));
      readFileSync(join(PKG, entry.types));
    }
  });

  test("按包名能 import", async () => {
    const mod = await import("@needle/honox");
    expect(typeof mod).toBe("object");
  });
});
