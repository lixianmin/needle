import { describe, expect, test } from "bun:test";

import { displayNumber, toHuman } from "../../src/core/human.js";

describe("toHuman", () => {
  test("与 got/convert.ToHuman 对齐", () => {
    expect(toHuman(0)).toBe("0B");
    expect(toHuman(1023)).toBe("1023B");
    expect(toHuman(1024)).toBe("1.00K");
    expect(toHuman(1048576)).toBe("1.00M");
    expect(toHuman(1073741824)).toBe("1.00G");
  });

  test("负数与超大值", () => {
    expect(toHuman(-1024)).toBe("-1.00K");
    expect(toHuman(1024 ** 5)).toBe("1.00P");
    expect(toHuman(1024 ** 6)).toBe("1024.00P");
  });

  test("非有限值原样返回", () => {
    expect(toHuman(Number.NaN)).toBe("NaN");
    expect(toHuman(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("displayNumber", () => {
  test("小整数与比率原样显示", () => {
    expect(displayNumber(200)).toBe("200");
    expect(displayNumber(0.0234)).toBe("0.0234");
    expect(displayNumber(-5)).toBe("-5");
  });

  test("大于 1K 的整数转人话", () => {
    expect(displayNumber(36290560)).toBe("34.61M");
    expect(displayNumber(5000)).toBe("4.88K");
  });
});
