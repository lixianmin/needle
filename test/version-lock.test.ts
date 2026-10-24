import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = ["got", "logo", "shell", "honox"];

/**
 * 版本号只有根 `package.json` 一个来源。
 *
 * `package.json` 没有字段引用语法，所以三包的 version 靠 `bun run version:sync`
 * 机械写入；这条测试是兜底：忘了同步就红，而不是发出几个不同版本的包。
 */
function version(rel: string): string | undefined {
  const pkg = JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as { version?: string };
  return pkg.version;
}

describe("版本号只有根一个来源", () => {
  test("根 package.json 有 version", () => {
    expect(typeof version("package.json")).toBe("string");
  });

  test("各包的 version 与根逐字相等", () => {
    const root = version("package.json");
    for (const name of PACKAGES) {
      expect(version(`packages/${name}/package.json`)).toBe(root);
    }
  });

  test("bun.lock 里记录的各包版本也是根版本", () => {
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
    const root = version("package.json");
    for (const name of PACKAGES) {
      // bun.lock 每项是 { "name": "...", "version": "..." }，格式带尾随逗号，正则取这一段。
      const match = new RegExp(`"name": "@needle/${name}",\\s*\\n\\s*"version": "([^"]+)"`).exec(lock);
      expect(match?.[1]).toBe(root);
    }
  });
});
