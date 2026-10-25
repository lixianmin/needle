import { describe, expect, test } from "bun:test";

import { STYLE } from "../src/ui/style.js";

/** 取某条选择器的声明块内容；选择器必须存在，否则测试本身就该红。 */
function ruleBlock(selector: string): string {
  const start = STYLE.indexOf(selector);
  if (start < 0) {
    throw new Error(`没有这条规则：${selector}`);
  }

  const open = STYLE.indexOf("{", start);
  const close = STYLE.indexOf("}", open);
  return STYLE.slice(open + 1, close);
}

describe("tips 样本气泡的排版", () => {
  // warning.log 的末尾样本是长 JSON（93 字符 ≈ 728px）：只有 pre-wrap 时行内没有断行
  // 机会，直接冲出 560px 的气泡（Chrome 实测 scrollWidth 736 / clientWidth 558）。
  // 主面板的 .row .head 早就写了 overflow-wrap: anywhere，气泡漏了同一条。
  test("tips_text 有宽度上限，超长 token 也要折行", () => {
    const block = ruleBlock(".logo-shell .tips .tips_text");
    expect(block).toContain("max-width");
    expect(block).toContain("white-space: pre-wrap");
    expect(block).toContain("overflow-wrap: anywhere");
  });
});
