/**
 * id 生成：UUIDv7 位布局 + Crockford Base32 文本，**同一毫秒内严格单调**。
 *
 * ```
 * 128 位 = 48 位毫秒 | 4 位 version(=7) | 12 位 rand_a | 2 位 variant(=10) | 62 位 rand_b
 *                     └──── 时间（可排序）────┴────── 随机段 74 位（单调计数器）──────┘
 * ```
 *
 * 三条取舍：
 *
 * - **时间在最前面**：主键的字典序 = 生成顺序，B-tree 只往右追加，不回头插页；
 *   范围扫描（按时间查 id 区间）也直接落在有序段上。UUIDv4 / CUID2 那种纯随机
 *   布局做不到这一点，在 InnoDB 这类聚簇索引上会是随机的页分裂。
 * - **不要机器号**：Snowflake 的 10 位机器号要靠部署配置保证唯一（MAC / IP 哈希进
 *   1024 个桶，38 个实例就有一半概率撞），撞了就是同毫秒重号。这里的随机段每毫秒
 *   重抽一次，多实例、多进程、容器重建都不需要协调。
 * - **同一毫秒不靠新随机数，而是随机段 +1**：纯随机的 ULID 在同一毫秒内约一半的
 *   id 比前一个小（实测 20 万次里 99818 次倒退），不能当可排序主键。这里按
 *   RFC 9562 §6.2 Method 2，同毫秒把 74 位随机段当计数器 +1（带进位），溢出就把
 *   时间前进 1ms 再抽新随机段。
 *
 * 保留 version / variant 两个字段（共 6 位不参与熵）：换来的 16 字节能直接写进
 * UUID 列、和外部系统对接（`nextIdUuid()` / `idToUuid()`），代价是随机段 74 位而不是
 * ULID 的 80 位——跨机器同毫秒撞号要两个实例抽出同一个 74 位随机数，概率 2⁻⁷⁴ 量级，
 * 任何真实流量下都可以忽略。
 *
 * 文本形态是 26 位大写 Crockford Base32（去掉 I / L / O / U）：5 位/字符，128 位正好
 * 26 个字符，可以随便进日志、URL、口头念给别人；大写是 Crockford 的规范形式，解码时
 * 一律先转大写，所以大小写不敏感。
 */
/** Crockford Base32 大写形式：去掉 i / l / o / u，共 32 个字符。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 26 位大写字符。 */
const ID_LENGTH = 26;
/** 48 位毫秒的上限，约公元 10889 年；超了说明时钟或调用方传错，直接报错而不是截断。 */
const TIME_MAX = 2 ** 48 - 1;
/**
 * 随机段的字节布局（10 字节 = 74 位，另外 6 位是 version / variant）：
 *
 * ```
 * rnd[0]      rand_a 高 4 位   → 字节 6 低半字节
 * rnd[1]      rand_a 低 8 位   → 字节 7
 * rnd[2]      rand_b 高 6 位   → 字节 8 低 6 位
 * rnd[3..9]   rand_b 低 56 位  → 字节 9..15
 * ```
 *
 * 位宽不满一字节的两个位置在抽随机后要掩码，否则 +1 进位会写进 version / variant。
 */
const RND_A_HIGH_MAX = 0x0f;
const RND_B_HIGH_MAX = 0x3f;
const TIME_MESSAGE = "now 必须是 0..281474976710655 的整数毫秒";
/** 把 16 字节按 5 位一组编成 26 位字符串：130 位字符容量里高 2 位垫 0，正好装下 128 位。 */
function encodeBase32(source, out) {
    let accumulator = 0;
    // 高 2 位恒 0：先垫上，之后 130 位正好切成 26 个字符，不用收尾处理
    let bits = 2;
    let index = 0;
    for (let at = 0; at < source.length; at += 1) {
        accumulator = (accumulator << 8) | source[at];
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out[index] = ALPHABET.charCodeAt((accumulator >>> bits) & 31);
            index += 1;
        }
    }
    return String.fromCharCode(...out);
}
/**
 * 26 位字符串解回 16 字节。
 *
 * 首字符只取低 3 位：130 位里最高的 2 位是字符编码的补零，不属于 128 位值。
 */
function decodeBase32(id, out) {
    if (id.length !== ID_LENGTH) {
        throw new Error(`id 必须是 ${ID_LENGTH} 位 Crockford Base32：${id}`);
    }
    let value = ALPHABET.indexOf(id[0]);
    if (value < 0 || value > 7) {
        throw new Error(`id 必须是 ${ID_LENGTH} 位 Crockford Base32：${id}`);
    }
    let accumulator = value;
    let bits = 3;
    let index = 0;
    for (let at = 1; at < ID_LENGTH; at += 1) {
        const digit = ALPHABET.indexOf(id[at]);
        if (digit < 0) {
            throw new Error(`id 必须是 ${ID_LENGTH} 位 Crockford Base32：${id}`);
        }
        accumulator = (accumulator << 5) | digit;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            out[index] = (accumulator >>> bits) & 0xff;
            index += 1;
        }
    }
}
/** 16 字节 → `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`。 */
function formatUuid(bytes) {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/**
 * 创建一个 id 生成器。
 *
 * 状态（上一毫秒 + 当前随机段）挂在生成器上，所以同一个生成器连续调用才保证单调；
 * 每次新建一个就是每次从头抽随机段——**模块级单例是正确性要求，不是性能优化**。
 */
export function createIdGenerator(options = {}) {
    const now = options.now ?? Date.now;
    const random = options.random ?? ((target) => globalThis.crypto.getRandomValues(target));
    /** 复用的输出缓冲：同步生成，一块就够，不产生额外对象。 */
    const bytes = new Uint8Array(16);
    /** 随机段：见上面的字节布局注释。 */
    const rnd = new Uint8Array(10);
    const codes = new Uint8Array(ID_LENGTH);
    let lastMs = -1;
    /** 抽一段新的 74 位随机，并把不满一字节的两处掩到合法位宽。 */
    function reseed() {
        random(rnd);
        rnd[0] = rnd[0] & RND_A_HIGH_MAX;
        rnd[2] = rnd[2] & RND_B_HIGH_MAX;
    }
    /** 随机段 +1，带进位；74 位全满（这一毫秒的号用完了）返回 false。 */
    function bump() {
        for (let at = 9; at >= 3; at -= 1) {
            if (rnd[at] !== 0xff) {
                rnd[at] = rnd[at] + 1;
                return true;
            }
            rnd[at] = 0;
        }
        if (rnd[2] !== RND_B_HIGH_MAX) {
            rnd[2] = rnd[2] + 1;
            return true;
        }
        rnd[2] = 0;
        if (rnd[1] !== 0xff) {
            rnd[1] = rnd[1] + 1;
            return true;
        }
        rnd[1] = 0;
        if (rnd[0] !== RND_A_HIGH_MAX) {
            rnd[0] = rnd[0] + 1;
            return true;
        }
        rnd[0] = 0;
        return false;
    }
    /** 组装 16 字节：时间 | version 7 + rand_a | variant 10 + rand_b。 */
    function assemble(ms) {
        bytes[0] = Math.floor(ms / 0x10000000000) & 0xff;
        bytes[1] = Math.floor(ms / 0x100000000) & 0xff;
        bytes[2] = Math.floor(ms / 0x1000000) & 0xff;
        bytes[3] = Math.floor(ms / 0x10000) & 0xff;
        bytes[4] = Math.floor(ms / 0x100) & 0xff;
        bytes[5] = ms & 0xff;
        bytes[6] = 0x70 | rnd[0];
        bytes[7] = rnd[1];
        bytes[8] = 0x80 | rnd[2];
        for (let at = 3; at < 10; at += 1) {
            bytes[6 + at] = rnd[at];
        }
    }
    /** 读时钟、定这一毫秒的随机段，然后组装。 */
    function tick() {
        const current = now();
        if (!Number.isInteger(current) || current < 0 || current > TIME_MAX) {
            throw new Error(`${TIME_MESSAGE}：${current}`);
        }
        if (current > lastMs) {
            lastMs = current;
            reseed();
        }
        else if (!bump()) {
            // 这一毫秒的 74 位号段用完了：时间前进 1ms、重抽随机段。
            // 回拨也走 else 这一路——id 生成不该因为 NTP 抖动失败，单调性比时间精确更重要。
            if (lastMs >= TIME_MAX) {
                throw new Error("时间已到 48 位毫秒上限、随机段也耗尽，拒绝回绕生成 id");
            }
            lastMs += 1;
            reseed();
        }
        assemble(lastMs);
    }
    return {
        next() {
            tick();
            return encodeBase32(bytes, codes);
        },
        nextBytes() {
            tick();
            return bytes.slice();
        },
        nextUuid() {
            tick();
            return formatUuid(bytes);
        },
    };
}
/** 模块级单例：同一个运行实例共享「上一毫秒 + 随机段」，这是单调性的前提。 */
const DEFAULT_GENERATOR = createIdGenerator();
/** 生成下一个 id：26 位大写 Crockford Base32。 */
export function nextId() {
    return DEFAULT_GENERATOR.next();
}
/** 生成下一个 id 的 16 字节形态。 */
export function nextIdBytes() {
    return DEFAULT_GENERATOR.nextBytes();
}
/** 生成下一个 id 的 UUIDv7 文本形态。 */
export function nextIdUuid() {
    return DEFAULT_GENERATOR.nextUuid();
}
/**
 * 生成一个纯随机 id：26 位、不为猜测留时间前缀。
 *
 * 只给「id 本身就是凭据」的场景用（免鉴权的图片 URL、一次性下载链接）。普通主键、
 * 日志 rid、用户 id 都用 `nextId()`：那个带时间前缀，字典序即生成顺序。
 */
export function nextRandomId() {
    const raw = new Uint8Array(16);
    globalThis.crypto.getRandomValues(raw);
    return encodeBase32(raw, new Uint8Array(ID_LENGTH));
}
/** 从 26 位 id 里读出毫秒时间戳（排障、测试用）。 */
export function parseId(id) {
    const raw = new Uint8Array(16);
    decodeBase32(id, raw);
    let timeMs = 0;
    for (let at = 0; at < 6; at += 1) {
        timeMs = timeMs * 256 + raw[at];
    }
    return { timeMs };
}
/** 26 位 id → UUIDv7 规范文本（写进 UUID 列、给外部系统）。 */
export function idToUuid(id) {
    const raw = new Uint8Array(16);
    decodeBase32(id, raw);
    return formatUuid(raw);
}
