// 这个 sink 依赖 node:fs：虽然放在 core/logo/sinks/ 下，但它只从 ./node 入口导出，
// `.` 入口不会引入它，Workers 打包时也就碰不到 node: 模块。
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { formatLine } from "../line.js";
import { LEVELS } from "../types.js";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_KEEP_DAYS = 7;
/** 可能建文件的级别，从最啰嗦到最严重。 */
const LEVELS_BY_FILE = ["debug", "info", "warn", "error"];
/**
 * 按级别分文件，且高级别级联写入低级别文件：
 *
 *   info.log  ← info, warn, error
 *   warn.log  ← warn, error
 *   error.log ← error
 *
 * 这样查一个问题不用同时翻三个文件：想先扫全局就看 info.log，只想看告警就
 * 看 warn.log。文件按需创建——没开 debug 就不会冒出一个空的 debug.log。
 *
 * 写盘用 appendFileSync：整个批量设计就是"每 100ms 一次 IO"，一次阻塞写
 * 换来的是「warn/error 立即落盘」和「退出前 flush 就真的写下去了」。
 */
export function createFileSink(options) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS;
    const now = options.now ?? Date.now;
    const minLevel = options.minLevel ?? "info";
    // 级联的落点是 [minLevel, 记录级别]，所以 error 会进 info/warn/error，
    // 但不会凭空造一个 debug.log。
    const fileLevels = LEVELS_BY_FILE.filter((level) => LEVELS[level] >= LEVELS[minLevel]);
    const bytes = new Map();
    let closed = false;
    function ensureDir() {
        if (!existsSync(options.dir))
            mkdirSync(options.dir, { recursive: true });
    }
    function prune() {
        const cutoff = now() - keepDays * 24 * 60 * 60 * 1000;
        for (const name of readdirSync(options.dir)) {
            // 只清归档（带时间戳的），当前正在写的四个文件不动。
            if (!name.endsWith(".log") || !name.includes("-"))
                continue;
            const path = join(options.dir, name);
            try {
                if (statSync(path).mtimeMs < cutoff)
                    unlinkSync(path);
            }
            catch {
                // 被别的进程删了/锁了：下一次滚动再处理。
            }
        }
    }
    function rotate(file, level) {
        if (!existsSync(file)) {
            bytes.set(level, 0);
            return;
        }
        const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
        renameSync(file, join(options.dir, `${level}-${stamp}.log`));
        bytes.set(level, 0);
        prune();
    }
    function write(level, lines) {
        if (lines.length === 0)
            return;
        const file = join(options.dir, `${level}.log`);
        const text = `${lines.join("\n")}\n`;
        const size = Buffer.byteLength(text, "utf8");
        const current = bytes.get(level) ?? 0;
        if (current > 0 && current + size > maxBytes)
            rotate(file, level);
        appendFileSync(file, text, "utf8");
        bytes.set(level, (bytes.get(level) ?? 0) + size);
    }
    const sink = ((batch) => {
        if (closed || batch.length === 0)
            return;
        ensureDir();
        // 先按目标文件分组：一条 warn 会同时进 info.log 与 warn.log，
        // 但只做两次批量写，而不是逐条写。
        const buckets = new Map();
        for (const record of batch) {
            for (const target of fileLevels) {
                if (LEVELS[record.level] < LEVELS[target])
                    continue;
                const lines = buckets.get(target) ?? [];
                lines.push(formatLine(record));
                buckets.set(target, lines);
            }
        }
        for (const [level, lines] of buckets)
            write(level, lines);
    });
    sink.close = () => {
        closed = true;
    };
    return sink;
}
