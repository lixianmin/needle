import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..");

/**
 * 「浏览器里只用日志不沾 node:」的兜底验证。
 *
 * 为什么不能靠构建失败来保证：`bun build --target=browser` 遇到 `node:` 不会
 * 报错，它把 `node:fs` 静默替换成 `{}`、给 `node:path` 塞个垫片——产物照样
 * 生成，运行时才炸。所以只能在打包后检查产物内容。
 */
async function bundle(entry: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(PKG, entry)],
    target: "browser",
    format: "esm",
  });
  if (!result.success) {
    throw new Error(result.logs.map(String).join("\n"));
  }

  const output = result.outputs[0];
  if (output === undefined) {
    throw new Error(`没有构建产物: ${entry}`);
  }

  return output.text();
}

function expectBrowserClean(code: string): void {
  expect(code).not.toContain('from "node:');
  expect(code).not.toContain("require(");
  // workerd 不接受非字面量的模块说明符；浏览器打包里出现动态 import 也是隐患。
  expect(code).not.toContain("import(");
}

describe("@needle/logo 的浏览器入口不碰 node:", () => {
  test("根入口（只记日志）打出来的包是干净的", async () => {
    expectBrowserClean(await bundle("src/index.ts"));
  });
});
