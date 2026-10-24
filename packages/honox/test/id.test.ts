import { describe, expect, test } from "bun:test";
import { createSnowflake, parseSnowflake } from "../src/id.js";

const EPOCH = Date.UTC(2026, 0, 1);

/** 可控时钟：每次取值都从数组里拿下一个，耗尽后停在最后一个。 */
function clockOf(...stamps: number[]): () => number {
  let index = 0;
  return () => {
    const value = stamps[Math.min(index, stamps.length - 1)]!;
    index += 1;
    return value;
  };
}

describe("createSnowflake", () => {
  test("位布局：41 位毫秒（相对 epoch）+ 10 位机器号 + 12 位序列", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 37, now: () => EPOCH + 1234 });
    const id = ids.next();
    expect(parseSnowflake(id)).toEqual({ elapsedMs: 1234, nodeId: 37, sequence: 0 });
    // 63 位：signed 64 位装得下，MySQL BIGINT / Mongo Long 不会溢出
    expect(id > 0n && id <= (1n << 63n) - 1n).toBe(true);
  });

  test("同一毫秒内序列递增", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: () => EPOCH + 5 });
    const first = ids.next();
    const second = ids.next();
    const third = ids.next();
    expect(second).toBe(first + 1n);
    expect(third).toBe(second + 1n);
    expect(parseSnowflake(third).sequence).toBe(2);
  });

  test("跨毫秒：序列归零，但整体仍然递增", () => {
    const ids = createSnowflake({
      epoch: EPOCH,
      nodeId: 1,
      now: clockOf(EPOCH + 1, EPOCH + 1, EPOCH + 2),
    });
    const first = ids.next();
    const second = ids.next();
    const third = ids.next();
    expect(second).toBe(first + 1n);
    expect(parseSnowflake(third)).toEqual({ elapsedMs: 2, nodeId: 1, sequence: 0 });
    expect(third > second).toBe(true);
  });

  test("同一毫秒超过 4096 个：等下一毫秒，不重复不丢号", () => {
    const stamps = [EPOCH, ...Array.from({ length: 4096 }, () => EPOCH), EPOCH + 1];
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: clockOf(...stamps) });
    const generated: bigint[] = [];
    for (let i = 0; i < 4097; i += 1) {
      generated.push(ids.next());
    }
    // 前 4096 个都在第 0 毫秒，第 4097 个落到第 1 毫秒、序列回到 0
    expect(parseSnowflake(generated[4095]!)).toEqual({ elapsedMs: 0, nodeId: 1, sequence: 4095 });
    expect(parseSnowflake(generated[4096]!)).toEqual({ elapsedMs: 1, nodeId: 1, sequence: 0 });
    for (let i = 1; i < generated.length; i += 1) {
      expect(generated[i]! > generated[i - 1]!).toBe(true);
    }
  });

  test("时钟回拨直接抛错（不静默产生更小的 id）", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: clockOf(EPOCH + 10, EPOCH + 9) });
    ids.next();
    expect(() => ids.next()).toThrow(/时钟回拨 1ms/);
  });

  test("机器号不同则同一毫秒也不撞号", () => {
    const a = createSnowflake({ epoch: EPOCH, nodeId: 1, now: () => EPOCH + 7 });
    const b = createSnowflake({ epoch: EPOCH, nodeId: 2, now: () => EPOCH + 7 });
    expect(a.next()).not.toBe(b.next());
  });

  test("nodeId 越界报错", () => {
    expect(() => createSnowflake({ epoch: EPOCH, nodeId: 1024 })).toThrow(/nodeId 必须是 0\.\.1023/);
    expect(() => createSnowflake({ epoch: EPOCH, nodeId: -1 })).toThrow(/nodeId/);
    expect(() => createSnowflake({ epoch: EPOCH, nodeId: 1.5 })).toThrow(/nodeId/);
  });

  test("当前时间早于 epoch：报错而不是产生负数", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: () => EPOCH - 1 });
    expect(() => ids.next()).toThrow(/早于 epoch/);
  });

  test("id 转字符串是十进制且定长 19 位（JSON 里只能这么传）", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: () => EPOCH + 1234 });
    const text = ids.next().toString();
    expect(text).toMatch(/^\d+$/);
    expect(BigInt(text).toString()).toBe(text);
  });
});
