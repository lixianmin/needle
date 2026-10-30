import { describe, expect, test } from "bun:test";
import { createIdGenerator, idToUuid, nextId, nextIdBytes, nextIdUuid, nextRandomId, parseId } from "../src/id.js";

/** 26 位大写 Crockford：去掉 I / L / O / U。 */
const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** UUIDv7 的规范文本：第三段以 7 开头，第四段首位是 8/9/a/b（variant 10xx）。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 随机段掩码：rand_a（12 位，在 64..75）+ rand_b（62 位，在 0..61），中间夹着 version/variant。 */
const RANDOM_MASK = (((1n << 12n) - 1n) << 64n) | ((1n << 62n) - 1n);

/** 把 26 位解回 128 位整数：130 位里高 2 位恒 0，所以直接当 128 位读。 */
function decode(id: string): bigint {
  let value = 0n;
  for (const char of id) {
    value = value * 32n + BigInt(ALPHABET.indexOf(char));
  }

  return value;
}

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 可控时钟：每次取值都从数组里拿下一个，耗尽后停在最后一个。 */
function clockOf(...stamps: number[]): () => number {
  let index = 0;
  return () => {
    const value = stamps[Math.min(index, stamps.length - 1)]!;
    index += 1;
    return value;
  };
}

/** 固定随机源：(now, random) 相同的两个生成器必须产出同一串 id。 */
const FIVES = (target: Uint8Array): void => {
  target.fill(0x5a);
};

describe("nextId", () => {
  test("定长 26 位大写 Crockford Base32，不含 I / L / O / U", () => {
    const id = nextId();
    expect(id).toMatch(ID_PATTERN);
    expect(id).toHaveLength(26);
    expect(/[ilou]/.test(id.toLowerCase())).toBe(false);
  });

  test("位布局：前 48 位是毫秒时间戳，version = 7，variant = 10", () => {
    const now = Date.UTC(2026, 0, 2, 3, 4, 5);
    const value = decode(createIdGenerator({ now: () => now }).next());
    expect(Number(value >> 80n)).toBe(now);
    expect(Number((value >> 76n) & 0xfn)).toBe(7);
    expect(Number((value >> 62n) & 0x3n)).toBe(2);
  });

  test("时间位用满 48 位仍是 26 位，时间不被截断", () => {
    const value = decode(createIdGenerator({ now: () => 2 ** 48 - 1 }).next());
    expect(Number(value >> 80n)).toBe(2 ** 48 - 1);
  });

  test("跨毫秒：字典序 = 时间序", () => {
    const stamps = [0, 1, 2, 999, 1000, 2 ** 32, Date.UTC(2083, 0, 1)];
    const generator = createIdGenerator({ now: clockOf(...stamps) });
    const generated = stamps.map(() => generator.next());
    expect([...generated].sort()).toEqual(generated);
  });

  test("同一毫秒内 20 万个 id 严格递增且不重号", () => {
    const generator = createIdGenerator({ now: () => Date.UTC(2026, 5, 1) });
    const ids = Array.from({ length: 200_000 }, () => generator.next());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  test("同一毫秒内随机段逐个 +1（含进位）", () => {
    // 低两字节全 1：再 +1 必须进位到第三字节，而不是只改最后一个字符
    const generator = createIdGenerator({
      now: () => 1000,
      random: (target) => {
        target.fill(0);
        target[9] = 0xff;
        target[8] = 0xff;
      },
    });
    const first = decode(generator.next());
    expect(decode(generator.next())).toBe(first + 1n);
    expect(decode(generator.next())).toBe(first + 2n);
  });

  test("时钟回拨不倒退、不抛错：按同一毫秒继续递增", () => {
    const generator = createIdGenerator({ now: clockOf(1000, 900, 800) });
    const ids = [generator.next(), generator.next(), generator.next()];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });

  test("同一毫秒随机段耗尽：时间进位 1ms，而不是重号", () => {
    const generator = createIdGenerator({ now: () => 1000, random: (target) => target.fill(0xff) });
    const first = generator.next();
    const second = generator.next();
    expect(decode(first) & RANDOM_MASK).toBe(RANDOM_MASK);
    expect(parseId(second).timeMs).toBe(1001);
    expect(second > first).toBe(true);
  });

  test("时间已到 48 位上限又随机段耗尽：抛错，不静默回绕", () => {
    const generator = createIdGenerator({ now: () => 2 ** 48 - 1, random: (target) => target.fill(0xff) });
    generator.next();
    expect(() => generator.next()).toThrow(/48 位毫秒/);
  });

  test("时间越界报错：48 位装不下就拒绝，不静默截断", () => {
    for (const bad of [-1, 2 ** 48, 1.5]) {
      expect(() => createIdGenerator({ now: () => bad }).next()).toThrow(/now/);
    }
  });
});

describe("nextBytes / nextUuid", () => {
  test("三种形态指向同一个 128 位值：26 位串 / 16 字节 / UUID 文本", () => {
    const now = Date.UTC(2026, 2, 3);
    const fromId = createIdGenerator({ now: () => now, random: FIVES });
    const fromBytes = createIdGenerator({ now: () => now, random: FIVES });
    const fromUuid = createIdGenerator({ now: () => now, random: FIVES });
    const id = fromId.next();
    const bytes = fromBytes.nextBytes();
    const uuid = fromUuid.nextUuid();

    expect(bytes).toHaveLength(16);
    expect(uuid).toMatch(UUID_PATTERN);
    expect(BigInt(`0x${hexOf(bytes)}`)).toBe(decode(id));
    expect(BigInt(`0x${uuid.replaceAll("-", "")}`)).toBe(decode(id));
    expect(idToUuid(id)).toBe(uuid);
  });

  test("nextIdBytes 每次返回独立副本：改坏一份不影响下一次", () => {
    const first = nextIdBytes();
    const second = nextIdBytes();
    expect(first).not.toBe(second);
    first.fill(0);
    expect(second.some((byte) => byte !== 0)).toBe(true);
  });

  test("模块级 nextId / nextIdUuid 都能直接当主键用（不抛、格式对）", () => {
    expect(nextId()).toMatch(ID_PATTERN);
    expect(nextIdUuid()).toMatch(UUID_PATTERN);
  });
});

describe("parseId / idToUuid", () => {
  test("非法输入直接拒绝：长度与字符集", () => {
    expect(() => parseId("abc")).toThrow(/id/);
    expect(() => parseId("0123456789ABCDEFGHJKMNPQRSU")).toThrow(/id/);
    expect(() => parseId(`I${nextId().slice(1)}`)).toThrow(/id/);
    expect(() => idToUuid("nope")).toThrow(/id/);
  });

  test("时间戳能还原：parseId 与注入的毫秒一致", () => {
    const now = Date.UTC(2026, 9, 31, 23, 59, 59);
    expect(parseId(createIdGenerator({ now: () => now }).next()).timeMs).toBe(now);
  });
});

describe("nextRandomId", () => {
  test("26 位大写 Crockford，高 2 位恒 0（首字符 ≤ '7'）", () => {
    expect(nextRandomId()).toMatch(ID_PATTERN);
    expect(nextRandomId()).toMatch(/^[0-7]/);
  });

  test("1000 次不重号", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => nextRandomId()));
    expect(ids.size).toBe(1000);
  });
});
