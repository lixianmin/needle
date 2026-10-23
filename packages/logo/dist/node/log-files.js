import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
/**
 * 把日志目录暴露给控制台。
 *
 * 只做两件事：列目录、按名字读文件。安全性全在 `read` 上——名字必须是目录里
 * 直接存在的条目，不允许路径分隔符，解析后的绝对路径还必须落在目录内。
 * 控制台那边只拿得到这个名字，拿不到任意路径。
 */
export function createLogFiles(options) {
    const dir = resolve(options.dir);
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
                const info = await stat(join(dir, name)).catch(() => null);
                if (info === null || !info.isFile())
                    continue;
                entries.push({ name, size: info.size, modified: info.mtimeMs });
            }
            return entries.sort((left, right) => left.name.localeCompare(right.name));
        },
        async read(name) {
            // 分隔符、.. 一律拒绝：不给自己留拼接路径的机会。
            if (name === "" || name.includes("/") || name.includes("\\") || name.includes("\0")) {
                return null;
            }
            const full = resolve(dir, name);
            if (full !== join(dir, name) || !full.startsWith(dir + sep))
                return null;
            try {
                return await readFile(full, "utf8");
            }
            catch {
                return null;
            }
        },
    };
}
