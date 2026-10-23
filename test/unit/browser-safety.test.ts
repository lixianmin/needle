import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/**
 * 「浏览器里只用日志不沾 node:」的兜底验证。
 *
 * 为什么不能靠构建失败来保证：`bun build --target=browser` 遇到 `node:` 不会
 * 报错，它把 `node:fs` 静默替换成 `{}`、给 `node:path` 塞个垫片——产物照样
 * 生成，运行时才炸。所以只能在打包后检查产物内容。
 *
 * Chrome 扩展与纯前端页走的就是这两条入口：根入口（只记日志）与 ./shell
 * （带界面）。`./node` 故意不测——它本来就只有 Node 能 import。
 */

async function bundle(entry: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(ROOT, entry)],
    target: "browser",
    format: "esm",
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));

  const output = result.outputs[0];
  if (output === undefined) throw new Error(`没有构建产物: ${entry}`);
  return output.text();
}

function expectBrowserClean(code: string): void {
  expect(code).not.toContain('from "node:');
  expect(code).not.toContain("require(");
  // workerd 不接受非字面量的模块说明符；浏览器打包里出现动态 import 也是隐患。
  expect(code).not.toContain("import(");
}

describe("浏览器入口不碰 node:", () => {
  test("根入口（只记日志）打出来的包是干净的", async () => {
    expectBrowserClean(await bundle("src/index.ts"));
  });

  test("./shell 入口（浏览器面板 / Chrome 扩展）打出来的包是干净的", async () => {
    expectBrowserClean(await bundle("src/shell/index.ts"));
  });
});

describe("依赖方向：shell → logo 单向", () => {
  // 合并成一个包之后，单向性不再由包依赖声明保证，只能由源码约束保证。
  test("src/logo 下不出现任何指向 src/shell 的导入", () => {
    const cwd = join(ROOT, "src/logo");
    const offenders = [...new Glob("**/*.ts").scanSync({ cwd })].filter((rel) => {
      const code = readFileSync(join(cwd, rel), "utf8");
      return /from\s+["'][^"']*\/shell\//.test(code) || /from\s+["']@needle\/needle\/shell/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
