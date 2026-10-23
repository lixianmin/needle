import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 按包名解析的验证：走 `exports` 映射（自引用），而不是相对路径。
 *
 * 需要 dist 已构建——`bun run build && bun test` 是标准顺序，`dist/` 也随仓库
 * 提交，所以单跑 `bun test` 一样能过。
 */
const ROOT = join(import.meta.dir, "..", "..");

describe("包的导出映射", () => {
  test("package.json 声明了三个入口，且都指向 dist", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, { types: string; default: string }>;
    };

    expect(pkg.name).toBe("@needle/needle");
    expect(Object.keys(pkg.exports)).toEqual([".", "./shell", "./node"]);

    for (const entry of Object.values(pkg.exports)) {
      expect(entry.default.startsWith("./dist/")).toBe(true);
      expect(entry.types.startsWith("./dist/")).toBe(true);
      // 产物随源码提交：映射指向的文件必须真实存在，否则消费者装下来是坏的。
      readFileSync(join(ROOT, entry.default));
      readFileSync(join(ROOT, entry.types));
    }
  });

  test("@needle/needle、/shell、/node 都能按包名解析", async () => {
    const root = await import("@needle/needle");
    const shell = await import("@needle/needle/shell");
    const node = await import("@needle/needle/node");

    expect(typeof root.logo.info).toBe("function");
    expect(typeof root.createLarkSink).toBe("function");
    expect(typeof shell.createShell).toBe("function");
    expect(typeof shell.table).toBe("function");
    expect(typeof node.createFileSink).toBe("function");
    expect(typeof node.createLogFiles).toBe("function");
    expect(typeof node.serve).toBe("function");
    expect(typeof node.attach).toBe("function");
  });
});
