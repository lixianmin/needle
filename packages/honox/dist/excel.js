import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { readXlsx } from "hucre/xlsx";
/** 同一文件里的多个 sheet 只解析一次 zip；失败时把缓存删掉，允许重试。 */
const workbooks = new Map();
function loadWorkbook(path) {
    const cached = workbooks.get(path);
    if (cached !== undefined) {
        return cached;
    }
    const pending = readXlsx(readFileSync(path));
    workbooks.set(path, pending);
    pending.catch(() => {
        workbooks.delete(path);
    });
    return pending;
}
function defaultSheetName(file) {
    const name = basename(file);
    const ext = extname(name);
    return ext === "" ? name : name.slice(0, -ext.length);
}
/** 首行当表头：trim + 小写；空表头列直接丢掉（合并单元格常留空）。 */
function headerOf(rows) {
    return (rows[0] ?? []).map((value) => value === null || value === undefined ? "" : String(value).trim().toLowerCase());
}
/** 把二维表转成对象数组；这里不用 hucre 的 sheetToObjects，因为它不做小写归一。 */
function toRecords(worksheet) {
    const header = headerOf(worksheet.rows);
    return worksheet.rows.slice(1).map((cells) => {
        const row = {};
        header.forEach((key, index) => {
            if (key === "") {
                return;
            }
            row[key] = cells[index] ?? null;
        });
        return row;
    });
}
/** 整行为空是 Excel 的常态（格式化过的空行），不该当成"缺 id"报错。 */
function isEmptyRow(row) {
    return Object.values(row).every((value) => value === null || value === undefined || value === "");
}
/**
 * 一张 sheet 变成一个类型化、按 id 取数的配置源。
 *
 * 不用类名当 sheet 名：打包压缩后 `constructor.name` 会变成 `e`，
 * 线上就找不到 sheet 了。sheet 名写在参数里，压缩与否都成立。
 */
export function defineSheet(options) {
    const file = resolve(process.cwd(), options.file);
    const name = options.sheet ?? defaultSheetName(file);
    const idKey = (options.id ?? "id").trim().toLowerCase();
    const state = { loaded: false, byId: new Map(), list: [] };
    let pending = null;
    function requireLoaded(what) {
        if (!state.loaded) {
            throw new Error(`Excel 尚未加载：先 await loadSheets([...]) 再调 ${what}`);
        }
    }
    async function doLoad() {
        const workbook = await loadWorkbook(file);
        const worksheet = workbook.sheets.find((candidate) => candidate.name === name);
        if (worksheet === undefined) {
            throw new Error(`找不到 sheet：${name}（文件 ${file}；可用：${workbook.sheets.map((s) => s.name).join("、")}）`);
        }
        const data = toRecords(worksheet);
        const byId = new Map();
        const list = [];
        data.forEach((row, index) => {
            if (isEmptyRow(row)) {
                return;
            }
            // 行号按 Excel 的 1 基算：表头占第 1 行，data[0] 是第 2 行。
            const excelRow = index + 2;
            const id = row[idKey];
            if (typeof id !== "number" || !Number.isFinite(id)) {
                throw new Error(`${file}#${name} 第 ${excelRow} 行 ${idKey} 不是数字：${id === undefined ? "(缺列)" : String(id)}`);
            }
            if (byId.has(id)) {
                throw new Error(`${file}#${name} 重复 ${idKey}：${id}（第 ${excelRow} 行）`);
            }
            // 行对象原样保留：多出来的列是配置表常见的备注列，不该被裁掉。
            byId.set(id, row);
            list.push(row);
        });
        // 全部成功才落地：半加载状态会让"重试"变成"读到一半的旧数据"。
        state.byId = byId;
        state.list = list;
        state.loaded = true;
    }
    function load() {
        if (state.loaded) {
            return Promise.resolve();
        }
        if (pending === null) {
            pending = doLoad().finally(() => {
                pending = null;
            });
        }
        return pending;
    }
    return {
        name,
        get(id) {
            requireLoaded("get()");
            return state.byId.get(id);
        },
        all() {
            requireLoaded("all()");
            return state.list;
        },
        load,
    };
}
/** 批量预载：逐个调 `load()`，遇到第一个失败就抛。 */
export async function loadSheets(sheets) {
    for (const sheet of sheets) {
        await sheet.load();
    }
}
