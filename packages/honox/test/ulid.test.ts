import { describe, expect, test } from "bun:test";
import { isUlid, ulid } from "../src/ulid.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function decodeTime(id: string): number {
  let value = 0;
  for (const char of id.slice(0, 10)) {
    value = value * 32 + ALPHABET.indexOf(char);
  }
  return value;
}

describe("ulid", () => {
  test("26 位，只用 Crockford Base32 字符集", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect([...id].every((char) => ALPHABET.includes(char))).toBe(true);
    // Crockford 里去掉了容易看混的四个字母
    expect(/[ILOU]/.test(id)).toBe(false);
  });

  test("前 10 位就是毫秒时间戳", () => {
    const now = 1_700_000_000_123;
    expect(decodeTime(ulid(now))).toBe(now);
  });

  test("同一毫秒内两次生成也不同", () => {
    const now = 1_700_000_000_000;
    expect(ulid(now)).not.toBe(ulid(now));
  });

  test("时间晚的 ULID 字典序更大", () => {
    const early = ulid(1_700_000_000_000);
    const late = ulid(1_700_000_001_000);
    expect(late > early).toBe(true);
  });

  test("isUlid：认自己生成的，不认 UUID / 小写 / 含 I·L·O·U 的串", () => {
    expect(isUlid(ulid())).toBe(true);
    expect(isUlid("1f3947b3-a1cd-4ead-9343-17964dc158d2")).toBe(false);
    expect(isUlid("01arz3ndektsv4rrffq69g5fav")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAVX")).toBe(false);
  });
});
