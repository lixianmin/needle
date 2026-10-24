import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = ["core", "logo", "shell"];

/**
 * 版本号只有根 `package.json` 一个来源。
 *
 * `package.json` 没有字段引用语法，所以三包的 version 靠 `bun run version:sync`
 * 机械写入；这条测试是兜底：忘了同步就红，而不是发出三个不同版本的包。
 */
function version(rel: string): unknown {
  return (JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as { version?: unknown }).version;
}

describe("版本号只有根一个来源", () => {
  test("根 package.json 有 version", () => {
    expect(typeof version("package.json")).toBe("string");
  });

  test("三个包的 version 与根逐字相等", () => {
    const root = version("package.json");
    for (const name of PACKAGES) {
      expect(version(`packages/${name}/package.json`)).toBe(root);
    }
  });
});
