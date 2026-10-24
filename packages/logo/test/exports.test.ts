import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 包根：test/ 的上一级就是 packages/logo。 */
const PKG = join(import.meta.dir, "..");

describe("@needle/logo 的导出映射", () => {
  test("两个入口都指向真实存在的 dist 文件", () => {
    const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, { types: string; default: string }>;
    };

    expect(pkg.name).toBe("@needle/logo");
    expect(Object.keys(pkg.exports)).toEqual([".", "./node"]);

    for (const entry of Object.values(pkg.exports)) {
      expect(entry.default.startsWith("./dist/")).toBe(true);
      expect(entry.types.startsWith("./dist/")).toBe(true);
      // 产物随源码提交：映射指向的文件必须真实存在，否则消费者装下来是坏的。
      readFileSync(join(PKG, entry.default));
      readFileSync(join(PKG, entry.types));
    }
  });

  test("按包名能拿到日志 API（含 lark）", async () => {
    const logo = await import("@needle/logo");
    expect(typeof logo.logo.info).toBe("function");
    expect(typeof logo.newLogger).toBe("function");
    expect(typeof logo.createLarkSink).toBe("function");
    expect(typeof logo.createIndexedDbStore).toBe("function");
  });

  test("./node 按包名能拿到 Node 专属能力", async () => {
    const node = await import("@needle/logo/node");
    expect(typeof node.createFileSink).toBe("function");
    expect(typeof node.createLogFiles).toBe("function");
  });
});
