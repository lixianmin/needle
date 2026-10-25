import { describe, expect, test } from "bun:test";

import { pickSources } from "../scripts/mutate-diff.js";

describe("pickSources", () => {
  const changed = [
    "packages/logo/src/line.ts",
    "packages/logo/src/types.ts",
    "packages/logo/src/sinks/idb.ts",
    "packages/logo/test/line.test.ts",
    "packages/logo/dist/line.js",
    "packages/honox/src/trace.ts",
    "README.md",
  ];

  test("只留该包 src 下的 .ts，types.ts / 测试 / dist 都排除", () => {
    expect(pickSources(changed, "packages/logo")).toEqual([
      "packages/logo/src/line.ts",
      "packages/logo/src/sinks/idb.ts",
    ]);
  });

  test("别的包的文件不会串过来", () => {
    expect(pickSources(changed, "packages/honox")).toEqual(["packages/honox/src/trace.ts"]);
    expect(pickSources(changed, "packages/shell")).toEqual([]);
  });

  test("没有改动时返回空数组（脚本据此跳过而不是报错）", () => {
    expect(pickSources([], "packages/logo")).toEqual([]);
  });
});
