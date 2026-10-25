import { describe, expect, test } from "bun:test";
import {
  createSnowflake,
  DEFAULT_EPOCH,
  nextSnowflakeId,
  nextUlid,
  parseSnowflake,
} from "../src/id-tools.js";

const EPOCH = Date.UTC(2026, 0, 1);
const SNOWFLAKE_PATTERN = /^[0-9a-hjkmnp-tv-z]{13}$/;
/** 26 位大写 Crockford：去掉 I / L / O / U。 */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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

/** 把 ULID 的 26 位解回 128 位整数，用来验证位布局（时间在前 48 位）。 */
function decodeUlid(id: string): bigint {
  let value = 0n;
  for (const char of id) {
    value = value * 32n + BigInt(ULID_ALPHABET.indexOf(char));
  }

  return value;
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
    expect(id).toMatch(SNOWFLAKE_PATTERN);
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

describe("nextSnowflakeId", () => {
  test("不传参：默认纪元 + 机器号 0，仍是 13 位可解析的字符串", () => {
    const id = nextSnowflakeId();
    expect(id).toMatch(SNOWFLAKE_PATTERN);
    expect(parseSnowflake(id).nodeId).toBe(0);
    // 默认纪元写死在库里：elapsedMs 能对上「现在 − 2014-12-09」就说明这个常量没漂。
    // 1 分钟容差足够吃掉测试自身的耗时，又远小于任何写错的日期（最短也差一天）。
    const expected = Date.now() - DEFAULT_EPOCH;
    expect(Math.abs(parseSnowflake(id).elapsedMs - expected)).toBeLessThan(60_000);
  });

  test("传 nodeId 就按这个号编进去（多实例靠它分流）", () => {
    expect(parseSnowflake(nextSnowflakeId({ nodeId: 7 })).nodeId).toBe(7);
    expect(parseSnowflake(nextSnowflakeId({ nodeId: 1023 })).nodeId).toBe(1023);
  });

  test("连续调用严格递增且不重复（同一毫秒靠序列位，跨毫秒靠时间位）", () => {
    const generated = Array.from({ length: 5000 }, () => nextSnowflakeId());
    expect(new Set(generated).size).toBe(generated.length);
    for (let index = 1; index < generated.length; index += 1) {
      expect(generated[index]! > generated[index - 1]!).toBe(true);
    }
  });

  test("同一组参数复用同一个生成器：序列不会每调用一次就归零", () => {
    // 每次都新建一个 Snowflake 的话，同毫秒内每次都发序列 0 → 直接撞号。
    const ids = Array.from({ length: 3 }, () => nextSnowflakeId({ nodeId: 3 }));
    const sequences = ids.map((id) => parseSnowflake(id).sequence);
    const elapsed = ids.map((id) => parseSnowflake(id).elapsedMs);
    const sameMs = elapsed.every((value) => value === elapsed[0]);
    // 同一毫秒内必须递增；恰好跨了毫秒的话序列归零，那就只检查不重复。
    expect(new Set(ids).size).toBe(3);
    if (sameMs) {
      expect(sequences[1]!).toBeGreaterThan(sequences[0]!);
    }
  });

  test("nodeId 越界照样报错", () => {
    expect(() => nextSnowflakeId({ nodeId: 1024 })).toThrow(/nodeId 必须是 0\.\.1023/);
  });
});

describe("nextUlid", () => {
  test("定长 26 位大写 Crockford Base32，不含 I / L / O / U", () => {
    const id = nextUlid();
    expect(id).toMatch(ULID_PATTERN);
    expect(id).toHaveLength(26);
    expect(/[ilou]/.test(id.toLowerCase())).toBe(false);
  });

  test("位布局：前 48 位是毫秒时间戳，后 80 位是随机数", () => {
    const now = Date.UTC(2026, 0, 2, 3, 4, 5);
    const id = nextUlid(now);
    // 130 位里高 2 位恒 0，所以整个 128 位值右移 80 位就是时间戳
    expect(Number(decodeUlid(id) >> 80n)).toBe(now);
  });

  test("可注入时间：只有时间位变，长度与字符集不变", () => {
    const early = nextUlid(0);
    const late = nextUlid(Date.UTC(2100, 0, 1));
    expect(early).toMatch(ULID_PATTERN);
    expect(late).toMatch(ULID_PATTERN);
    expect(late > early).toBe(true);
  });

  test("字典序 = 时间序（跨毫秒不会倒退）", () => {
    const stamps = [0, 1, 2, 999, 1000, 2 ** 32, Date.UTC(2083, 0, 1)];
    const generated = stamps.map((stamp) => nextUlid(stamp));
    expect([...generated].sort()).toEqual(generated);
  });

  test("同一毫秒内不重复：80 位随机顶住并发", () => {
    const now = Date.UTC(2026, 5, 1);
    const ids = Array.from({ length: 10_000 }, () => nextUlid(now));
    expect(new Set(ids).size).toBe(ids.length);
    // 高位（前 10 位）在同一毫秒内必然相同，差异只能来自后 16 位随机段
    expect(new Set(ids.map((id) => id.slice(0, 10))).size).toBe(1);
    expect(new Set(ids.map((id) => id.slice(10))).size).toBe(ids.length);
  });

  test("时间位用满 48 位也不溢出到第 11 个字符（首字符恒 < '8'）", () => {
    // 48 位最大值
    expect(nextUlid(2 ** 48 - 1)).toMatch(/^[0-7]/);
  });

  test("时间越界报错：48 位装不下就拒绝，不静默截断", () => {
    expect(() => nextUlid(-1)).toThrow(/nextUlid/);
    expect(() => nextUlid(2 ** 48)).toThrow(/nextUlid/);
    expect(() => nextUlid(1.5)).toThrow(/nextUlid/);
  });

  test("id 直接进 JSON：不需要任何转换", () => {
    const id = nextUlid();
    expect(JSON.parse(JSON.stringify({ id }))).toEqual({ id });
  });
});
