import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..");

/**
 * 「根入口能进 Workers / 浏览器打包」的兜底验证。
 *
 * 打包产物里出现 `node:` 不会让 `bun build --target=browser` 失败，它只是
 * 静默换成空实现，所以只能在打包后检查内容。
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

describe("@needle/honox 的根入口不碰 node:", () => {
  test("./ 入口打出来的包是干净的", async () => {
    expectBrowserClean(await bundle("src/index.ts"));
  });
});
