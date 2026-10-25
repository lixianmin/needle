import { describe, expect, test } from "bun:test";

import { displayNumber, formatDuration, toHuman } from "../src/human.js";

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

  test("1024 这个边界本身就算「大于 1K」，负数按绝对值判", () => {
    expect(displayNumber(1023)).toBe("1023");
    expect(displayNumber(1024)).toBe("1.00K");
    expect(displayNumber(-1024)).toBe("-1.00K");
  });
});

describe("formatDuration", () => {
  test("毫秒 / 秒 / 分 / 时 / 天", () => {
    expect(formatDuration(123)).toBe("123ms");
    expect(formatDuration(12_300)).toBe("12.3s");
    expect(formatDuration(312_000)).toBe("5m 12s");
    expect(formatDuration(7_980_000)).toBe("2h 13m");
    expect(formatDuration(277_200_000)).toBe("3d 5h");
  });

  test("边界", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(3_600_000)).toBe("1h 00m");
    expect(formatDuration(86_400_000)).toBe("1d 0h");
    expect(formatDuration(-12_300)).toBe("-12.3s");
  });

  test("非有限值原样返回（不落到 toFixed）", () => {
    expect(formatDuration(Number.NaN)).toBe("NaN");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe("-Infinity");
  });
});
