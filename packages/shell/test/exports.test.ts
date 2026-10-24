import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 包根：test/ 的上一级就是 packages/shell。 */
const PKG = join(import.meta.dir, "..");

describe("@needle/shell 的导出映射", () => {
  test("两个入口都指向真实存在的 dist 文件", () => {
    const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, { types: string; default: string }>;
    };

    expect(pkg.name).toBe("@needle/shell");
    expect(Object.keys(pkg.exports)).toEqual([".", "./node"]);

    for (const entry of Object.values(pkg.exports)) {
      expect(entry.default.startsWith("./dist/")).toBe(true);
      expect(entry.types.startsWith("./dist/")).toBe(true);
      readFileSync(join(PKG, entry.default));
      readFileSync(join(PKG, entry.types));
    }
  });

  test("按包名能拿到 Shell API", async () => {
    const shell = await import("@needle/shell");
    expect(typeof shell.createServerShell).toBe("function");
    expect(typeof shell.createBrowserShell).toBe("function");
    expect(typeof shell.table).toBe("function");
  });

  test("按包名能拿到 ResponseX：宿主应用复用同一套错误契约", async () => {
    const shell = await import("@needle/shell");
    expect(typeof shell.ResponseX.fail).toBe("function");
    expect(typeof shell.ResponseX.notFound).toBe("function");

    const res = shell.ResponseX.fail(403, "forbidden", "没有权限");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "forbidden", message: "没有权限" });
  });

  test("./node 按包名能拿到 serve / attach", async () => {
    const node = await import("@needle/shell/node");
    expect(typeof node.serve).toBe("function");
    expect(typeof node.attach).toBe("function");
  });
});
