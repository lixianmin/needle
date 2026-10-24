import { describe, expect, test } from "bun:test";
import { createSnowflake, parseSnowflake } from "../src/id.js";
import { nodeIdFromMac } from "../src/node.js";

const EPOCH = Date.UTC(2026, 0, 1);
const ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{13}$/;

/** 可控时钟：每次取值都从数组里拿下一个，耗尽后停在最后一个。 */
function clockOf(...stamps: number[]): () => number {
  let index = 0;
  return () => {
    const value = stamps[Math.min(index, stamps.length - 1)]!;
    index += 1;
    return value;
  };
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** 参考实现：纯 bigint 逐位算。热路径不用它（会分配大量临时对象），只用来对答案。 */
function reference(elapsed: number, node: number, sequence: number): string {
  let value = (BigInt(elapsed) << 22n) | (BigInt(node) << 12n) | BigInt(sequence);
  let out = "";
  for (let index = 0; index < 13; index += 1) {
    out = ALPHABET[Number(value % 32n)]! + out;
    value /= 32n;
  }
  return out;
}

describe("createSnowflake", () => {
  test("与 bigint 参考实现逐位一致（number 位运算拆分没写错）", () => {
    for (const elapsed of [0, 1, 1023, 1024, 1025, 2 ** 20 + 7, 2 ** 41 - 1]) {
      for (const node of [0, 1, 1023]) {
        const ids = createSnowflake({ epoch: EPOCH, nodeId: node, now: () => EPOCH + elapsed });
        expect(ids.next()).toBe(reference(elapsed, node, 0));
      }
    }
  });

  test("序列 4095（同一毫秒的最后一个号）也与参考实现一致", () => {
    const elapsed = 4096;
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 7, now: () => EPOCH + elapsed });
    let last = "";
    for (let i = 0; i < 4096; i += 1) {
      last = ids.next();
    }
    expect(last).toBe(reference(elapsed, 7, 4095));
  });

  test("返回定长 13 位 Crockford Base32 字符串", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 37, now: () => EPOCH + 1234 });
    const id = ids.next();
    expect(id).toMatch(ID_PATTERN);
    expect(id).toHaveLength(13);
    // 全小写；不许出现大写，也不许出现容易看混的 i / l / o / u
    expect(/[A-Z]/.test(id)).toBe(false);
    expect(/[ilou]/.test(id)).toBe(false);
  });

  test("位布局：41 位毫秒（相对 epoch）+ 10 位机器号 + 12 位序列", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 37, now: () => EPOCH + 1234 });
    expect(parseSnowflake(ids.next())).toEqual({ elapsedMs: 1234, nodeId: 37, sequence: 0 });
  });

  test("字典序 = 生成顺序（定长的意义所在）", () => {
    const ids = createSnowflake({
      epoch: EPOCH,
      nodeId: 1,
      now: clockOf(EPOCH, EPOCH, EPOCH + 1, EPOCH + 1000),
    });
    const generated = [ids.next(), ids.next(), ids.next(), ids.next()];
    const sorted = [...generated].sort();
    expect(sorted).toEqual(generated);
    // 跨位数也不会倒退：1 毫秒与 1000 毫秒的 id 前缀不同，但顺序仍然对
    expect(generated[3]! > generated[2]!).toBe(true);
  });

  test("同一毫秒内序列递增", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: () => EPOCH + 5 });
    const first = ids.next();
    const second = ids.next();
    expect(parseSnowflake(second).sequence).toBe(1);
    expect(second > first).toBe(true);
  });

  test("跨毫秒：序列归零，整体仍然递增", () => {
    const ids = createSnowflake({
      epoch: EPOCH,
      nodeId: 1,
      now: clockOf(EPOCH + 1, EPOCH + 1, EPOCH + 2),
    });
    const first = ids.next();
    const second = ids.next();
    const third = ids.next();
    expect(parseSnowflake(third)).toEqual({ elapsedMs: 2, nodeId: 1, sequence: 0 });
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
  });

  test("同一毫秒超过 4096 个：等下一毫秒，不重复不丢号", () => {
    // 时钟在前 4097 次都停在 EPOCH，之后才走到下一毫秒：这样自旋循环必须真的转一圈，
    // 否则序列溢出后仍停在同一毫秒（会重复发号）。
    let reads = 0;
    const ids = createSnowflake({
      epoch: EPOCH,
      nodeId: 1,
      now: () => {
        reads += 1;
        return reads > 4097 ? EPOCH + 1 : EPOCH;
      },
    });
    const generated: string[] = [];
    for (let i = 0; i < 4097; i += 1) {
      generated.push(ids.next());
    }
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

  test("41 位时间位到顶：超了就报错，边界值本身可用", () => {
    const TIME_MAX = 2 ** 41 - 1;
    const atMax = createSnowflake({ epoch: 0, nodeId: 1, now: () => TIME_MAX });
    expect(parseSnowflake(atMax.next()).elapsedMs).toBe(TIME_MAX);

    const over = createSnowflake({ epoch: 0, nodeId: 1, now: () => TIME_MAX + 1 });
    expect(() => over.next()).toThrow(/epoch 太早：41 位毫秒只够 \d+ 年/);
  });

  test("当前时间早于 epoch：报错而不是产生负数", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: () => EPOCH - 1 });
    expect(() => ids.next()).toThrow(/早于 epoch/);
  });

  test("解析不区分大小写（抄写/透传变大写也认得）", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 37, now: () => EPOCH + 1234 });
    const id = ids.next();
    expect(parseSnowflake(id.toUpperCase())).toEqual(parseSnowflake(id));
  });

  test("parseSnowflake 拒绝畸形输入", () => {
    expect(() => parseSnowflake("too-short")).toThrow(/必须是 13 位/);
    expect(() => parseSnowflake("000000000000i")).toThrow(/非法字符 i/);
  });

  test("id 直接进 JSON：不需要任何转换（这是只给字符串的意义）", () => {
    const ids = createSnowflake({ epoch: EPOCH, nodeId: 1, now: () => EPOCH + 1 });
    const id = ids.next();
    expect(JSON.parse(JSON.stringify({ id }))).toEqual({ id });
  });
});

describe("nodeIdFromMac", () => {
  test("返回 10 位范围内的整数，且多次调用一致", () => {
    const first = nodeIdFromMac();
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1023);
    expect(nodeIdFromMac()).toBe(first);
  });
});
