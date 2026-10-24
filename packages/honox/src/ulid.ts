/**
 * ULID：26 位 Crockford Base32。
 *
 * 前 10 位是毫秒时间戳（48 bit，够用到 10889 年），后 16 位是 80 bit 随机数。
 * 相比 UUID v4 的好处是可排序、能直接看出生成时间，而且定长 26 字符。
 *
 * 同一个毫秒里生成的两个 ULID 不保证有序（要实现单调版得在模块里存上一笔状态，
 * 请求 id 用不上这个性质）。
 */

/** Crockford Base32：去掉了容易看混的 I / L / O / U。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RADIX = 32;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

/** ULID 的合法形状：26 位、只用 Crockford 字符集（无 I / L / O / U）。 */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** 48 bit 时间戳编成 10 位 Base32（高位在前，所以同级字符串可比大小）。 */
function encodeTime(now: number): string {
  let rest = now;
  let out = "";
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    out = ALPHABET[rest % RADIX]! + out;
    rest = Math.floor(rest / RADIX);
  }
  return out;
}

/**
 * 80 bit 随机部分。
 * 取 16 个随机字节、每字节只留低 5 位：256 能被 32 整除，所以取模是均匀的，
 * 正好凑满 16 位 Base32。比按位拼 10 字节省事，熵一样是 80 bit。
 */
function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET[byte % RADIX]!;
  }
  return out;
}

/** 生成一个 ULID。`now` 只为测试注入时间用。 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/** 判断入站请求带来的 id 是不是 ULID。 */
export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
