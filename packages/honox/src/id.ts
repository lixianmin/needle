/**
 * Snowflake id：63 位整数 + 三段位，对外一律是**定长 13 位 Crockford Base32 字符串**。
 *
 * ```
 * 0 | 41 位毫秒 | 10 位机器号 | 12 位序列
 * ```
 *
 * 为什么对外只给字符串，不给 bigint：
 * - 63 位装不进 JS 的 `number`（只到 2^53），而 `JSON.stringify(bigint)` 直接抛
 *   TypeError。只要把 bigint 漏出去，就得靠每个调用点记得 `String()`——忘一次就是
 *   `c.json` 500 或者悄悄截断，这种"靠记性"的约束不该存在。
 * - 字符串从生成那一刻起就是最终形态：写日志、进 JSON、存 Mongo / MySQL 都不用转。
 *
 * 为什么定长 13 位：
 * - 63 位 ÷ 5 bit/字符 = 12.6 → 13 个字符正好装下（多出的 2 位恒为 0）。
 * - **等长才能让"字典序 = 数值序"**。若直接用十进制字符串，位数会从 10 涨到 19，
 *   而 `"9..."` 排在 `"10..."` 前面——新 id 会插到旧 id 之前，正是要避免的
 *   B 树回头插 / 页分裂。零填充也能解决，但 13 位比 19 位省 6 字节。
 * - Crockford 字母表去掉 I / L / O / U（容易看混），输出用小写（日志、URL、DB 里都好读）。
 *   ASCII 里 0-9 (48-57) 在 a-z (97-122) 之前，字母本身也升序，所以定长小写串
 *   仍然"字典序 = 数值序"。**必须全小写**：混用大小写会破坏这个性质。
 *
 * 时间位是 `now - epoch`，epoch 是**固定常量**（不是启动时间）：每次重启只是让
 * 时间继续往前走，不会把序列重置回起点。
 */

/**
 * Crockford Base32 小写形式：去掉 i / l / o / u，共 32 个字符。
 * ASCII 升序（0-9 在 a-z 之前），所以定长字符串直接比大小就是数值比较。
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const NODE_MAX = 1023;
const SEQUENCE_MAX = 4095;
/** 41 位毫秒能表示约 69 年；超了说明 epoch 配错了，直接报错而不是静默截断。 */
const TIME_MAX = 2 ** 41 - 1;

/** 13 个 ASCII 码位的复用缓冲：同步生成，一块就够，不产生额外对象。 */
const CODE_BUFFER = new Uint8Array(13);

export interface SnowflakeOptions {
  /**
   * 纪元（epoch 毫秒）。必须是一个写死的常量，不能用启动时间——
   * 否则每次重启时间位都会从头开始，id 会重复。
   */
  epoch: number;
  /** 机器号 0..1023。单机随便给；多实例必须互不相同（可用 `nodeIdFromMac()`）。 */
  nodeId: number;
  /** 注入时钟，测试用。 */
  now?: () => number;
}

export interface Snowflake {
  /** 生成下一个 id：定长 13 位 Crockford Base32。同一毫秒内序列递增；时钟回拨会抛错。 */
  next(): string;
}

/**
 * 63 位编成 13 位 Base32，只用 number 运算 + 一块复用缓冲。
 *
 * 不用 bigint 的原因：每个 bigint 的 `%` / `/` 都要分配新对象，生成 id 是热点
 * 路径（几十万次/秒），这些临时对象就是白烧的 GC。这里把 63 位拆成
 * hi(31 位) + lo(32 位) 两段按位取，最后一次性 `String.fromCharCode` 出串——
 * 每次调用只产生**一个**字符串。
 */
function encode(elapsedMs: number, nodeId: number, sequence: number): string {
  // 低 32 位：elapsed 的低 10 位 << 22 | node << 12 | seq（位运算按 int32 走，最后 >>>0 转无符号）
  let lo = (((elapsedMs % 1024) << 22) | (nodeId << 12) | sequence) >>> 0;
  let hi = Math.floor(elapsedMs / 1024);
  // 从最低的 5 位开始反向填：索引 12 是最低位，索引 0 是最高位（高位空缺自然是 '0'）
  for (let index = 12; index >= 0; index -= 1) {
    CODE_BUFFER[index] = ALPHABET.charCodeAt(lo & 31);
    lo = ((lo >>> 5) | ((hi & 31) << 27)) >>> 0;
    hi >>>= 5;
  }
  return String.fromCharCode(
    CODE_BUFFER[0]!,
    CODE_BUFFER[1]!,
    CODE_BUFFER[2]!,
    CODE_BUFFER[3]!,
    CODE_BUFFER[4]!,
    CODE_BUFFER[5]!,
    CODE_BUFFER[6]!,
    CODE_BUFFER[7]!,
    CODE_BUFFER[8]!,
    CODE_BUFFER[9]!,
    CODE_BUFFER[10]!,
    CODE_BUFFER[11]!,
    CODE_BUFFER[12]!,
  );
}

/** 解析不区分大小写（人工抄写、网关透传都可能变大写）；我们自己只输出小写。 */
function decode(id: string): bigint {
  if (id.length !== 13) {
    throw new Error(`Snowflake id 必须是 13 位：${id}`);
  }
  let value = 0n;
  for (const char of id) {
    const digit = ALPHABET.indexOf(char.toLowerCase());
    if (digit < 0) {
      throw new Error(`Snowflake id 含非法字符 ${char}：${id}`);
    }
    value = value * 32n + BigInt(digit);
  }
  return value;
}

/**
 * 创建一个 Snowflake 生成器。
 *
 * 时钟回拨：照原版算法**直接拒绝生成**。等时钟追上来会让请求卡住，
 * 静默产生更小的 id 又会破坏单调性（B 树回头插，正是要避免的页分裂）。
 * 序列溢出（同一毫秒超过 4096 个）则自旋等下一毫秒，这是 Snowflake 的常规做法。
 */
export function createSnowflake(options: SnowflakeOptions): Snowflake {
  if (!Number.isInteger(options.nodeId) || options.nodeId < 0 || options.nodeId > NODE_MAX) {
    throw new Error(`nodeId 必须是 0..${NODE_MAX} 的整数：${options.nodeId}`);
  }
  const epoch = options.epoch;
  const node = options.nodeId;
  const now = options.now ?? Date.now;

  let lastMs = -1;
  let sequence = 0;

  function untilNextMillis(previous: number): number {
    let current = now();
    while (current <= previous) {
      current = now();
    }
    return current;
  }

  return {
    next(): string {
      let current = now();

      if (current < lastMs) {
        throw new Error(
          `时钟回拨 ${lastMs - current}ms：拒绝生成 id（否则会破坏单调性）。检查 NTP / 容器时钟`,
        );
      }

      if (current === lastMs) {
        sequence += 1;
        if (sequence > SEQUENCE_MAX) {
          // 这一毫秒的 4096 个号用完了：等下一毫秒，号不会丢也不会重。
          current = untilNextMillis(lastMs);
          sequence = 0;
        }
      } else {
        sequence = 0;
      }

      const elapsed = current - epoch;
      if (elapsed < 0) {
        throw new Error(`当前时间早于 epoch（${epoch}）：检查系统时钟或 epoch 配置`);
      }
      if (elapsed > TIME_MAX) {
        throw new Error(`epoch 太早：41 位毫秒只够 ${Math.floor(TIME_MAX / 31_536_000_000)} 年`);
      }

      lastMs = current;
      return encode(elapsed, node, sequence);
    },
  };
}

/** 把 id 拆回三段，测试与排障用。`elapsedMs` 是相对 epoch 的毫秒数。 */
export function parseSnowflake(id: string): {
  elapsedMs: number;
  nodeId: number;
  sequence: number;
} {
  const value = decode(id);
  return {
    elapsedMs: Number(value >> 22n),
    nodeId: Number((value >> 12n) & 1023n),
    sequence: Number(value & 4095n),
  };
}
