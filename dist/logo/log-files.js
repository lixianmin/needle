import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
/**
 * 把日志目录暴露给控制台。
 *
 * 只做两件事：列目录、按名字读文件。安全性全在 `read` 上——名字必须是目录里
 * 直接存在的条目，不允许路径分隔符，解析后的绝对路径还必须落在目录内。
 * 控制台那边只拿得到这个名字，拿不到任意路径。
 */
export function createLogFiles(options) {
    const dir = resolve(options.dir);
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    /** 只暴露日志文件：目录里误放的 .env、备份、符号链接都不该被控制台读到。 */
    function isLogFile(name) {
        return name.endsWith(".log") && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
    }
    return {
        async list() {
            let names;
            try {
                names = await readdir(dir);
            }
            catch {
                // 目录还不存在（日志还没写过）：空列表比报错友好。
                return [];
            }
            const entries = [];
            for (const name of names) {
                if (!isLogFile(name)) {
                    continue;
                }
                const info = await lstat(join(dir, name)).catch(() => null);
                if (info === null || !info.isFile()) {
                    continue; // 符号链接 isFile() 为 false
                }
                entries.push({ name, size: info.size, modified: info.mtimeMs });
            }
            return entries.sort((left, right) => left.name.localeCompare(right.name));
        },
        async read(name) {
            // 分隔符、.. 一律拒绝：不给自己留拼接路径的机会。
            if (!isLogFile(name)) {
                return null;
            }
            const full = resolve(dir, name);
            if (full !== join(dir, name) || !full.startsWith(dir + sep)) {
                return null;
            }
            let handle;
            try {
                // O_NOFOLLOW + 句柄上 fstat：打开与检查是同一个对象，中间被换成符号链接
                // 会直接 ELOOP，写入增长也按打开那一刻之后的真实大小判断。
                handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
                const info = await handle.stat();
                if (!info.isFile() || info.size > maxFileBytes) {
                    return null;
                }
                return await handle.readFile("utf8");
            }
            catch {
                return null;
            }
            finally {
                await handle?.close().catch(() => { });
            }
        },
    };
}
