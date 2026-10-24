import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readXlsx, type CellValue, type Workbook } from "hucre/xlsx";

/**
 * sheet 名后缀约定（照 rim.server 的元数据管理）：
 * - `XxxTemplate`：按 id 取的单条数据，进两级索引的第一层 key 就是 sheet 名本身；
 * - `XxxConfig`：全局只有一份的配置；
 * - 其它 sheet 不是元数据表，扫描时跳过。
 */
const TEMPLATE_SUFFIX = "Template";
const CONFIG_SUFFIX = "Config";
const SPREADSHEET_EXTENSIONS: readonly string[] = [".xlsx", ".xlsm"];

export interface Template<T> {
  readonly name: string;
  get(id: number): T | undefined;
  all(): readonly T[];
}

export interface Config<T> {
  readonly name: string;
  get(): T;
}

export interface MetadataReport {
  readonly templates: readonly string[];
  readonly configs: readonly string[];
  /** 后缀既不是 Template 也不是 Config 的 sheet，扫描时跳过并在启动日志里列出。 */
  readonly skipped: readonly string[];
}

export interface Metadata {
  /** 扫描 dir（不递归），整体替换已加载的元数据。 */
  load(dir: string): Promise<MetadataReport>;
  /** 按 sheet 名取一个 Template 句柄；真正的数据在 load() 之后可读。 */
  template<T extends Record<string, unknown>>(name: string): Template<T>;
  /** 按 sheet 名取一个 Config 句柄；真正的数据在 load() 之后可读。 */
  config<T extends Record<string, unknown>>(name: string): Config<T>;
}

interface TemplateTable {
  readonly byId: ReadonlyMap<number, Record<string, CellValue>>;
  readonly list: readonly Record<string, CellValue>[];
}

interface State {
  loaded: boolean;
  templates: ReadonlyMap<string, TemplateTable>;
  configs: ReadonlyMap<string, Record<string, CellValue>>;
}

/** 同一文件里的多个 sheet 只解析一次 zip；失败时把缓存删掉，允许重试。 */
const workbooks = new Map<string, Promise<Workbook>>();

function loadWorkbook(path: string): Promise<Workbook> {
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

/** 首行当表头：trim + 小写；空表头列直接丢掉（合并单元格常留空）。 */
function headerOf(rows: readonly (readonly CellValue[])[]): string[] {
  return (rows[0] ?? []).map((value) =>
    value === null || value === undefined ? "" : String(value).trim().toLowerCase(),
  );
}

/** 把二维表转成对象数组；这里不用 hucre 的 sheetToObjects，因为它不做小写归一。 */
function toRecords(worksheet: { rows: CellValue[][] }): Record<string, CellValue>[] {
  const header = headerOf(worksheet.rows);
  return worksheet.rows.slice(1).map((cells) => {
    const row: Record<string, CellValue> = {};
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
function isEmptyRow(row: Record<string, CellValue>): boolean {
  return Object.values(row).every(
    (value) => value === null || value === undefined || value === "",
  );
}

function classify(sheetName: string): "template" | "config" | null {
  if (sheetName.endsWith(TEMPLATE_SUFFIX)) {
    return "template";
  }
  if (sheetName.endsWith(CONFIG_SUFFIX)) {
    return "config";
  }
  return null;
}

function listOf(names: Iterable<string>): string {
  const all = [...names];
  return all.length === 0 ? "(无)" : all.join("、");
}

/**
 * 一张 Template sheet → 按 id 建的表。
 *
 * 行号按 Excel 的 1 基算：表头占第 1 行，rows[0] 是第 2 行。
 */
function toTemplateTable(path: string, sheetName: string, rows: CellValue[][]): TemplateTable {
  const byId = new Map<number, Record<string, CellValue>>();
  const list: Record<string, CellValue>[] = [];

  toRecords({ rows }).forEach((row, index) => {
    if (isEmptyRow(row)) {
      return;
    }
    const excelRow = index + 2;
    const id = row.id;
    if (typeof id !== "number" || !Number.isFinite(id)) {
      throw new Error(
        `${path}#${sheetName} 第 ${excelRow} 行 id 不是数字：${id === undefined ? "(缺列)" : String(id)}`,
      );
    }
    if (byId.has(id)) {
      throw new Error(`${path}#${sheetName} 重复 id：${id}（第 ${excelRow} 行）`);
    }
    // 行对象原样保留：多出来的列是配置表常见的备注列，不该被裁掉。
    byId.set(id, row);
    list.push(row);
  });

  return { byId, list };
}

/** 一张 Config sheet → 第一个非空数据行（和 go-excel 读单结构体的口径一致）。 */
function toConfig(path: string, sheetName: string, rows: CellValue[][]): Record<string, CellValue> {
  const row = toRecords({ rows }).find((candidate) => !isEmptyRow(candidate));
  if (row === undefined) {
    throw new Error(`${path}#${sheetName} 是 Config，但没有数据行（第 2 行起至少要有 1 行）`);
  }
  return row;
}

/**
 * 创建一个元数据管理器。第一个 key 是 sheet 名（`BotTemplate` 这种大写原样），
 * 第二层才是 id——与 rim.server 的 routeTable → templateTable 同构。
 *
 * 用显式实例而不是模块级全局：测试各建一个，互不串状态。
 */
export function createMetadata(): Metadata {
  const state: State = { loaded: false, templates: new Map(), configs: new Map() };

  function requireLoaded(): void {
    if (!state.loaded) {
      throw new Error("元数据尚未加载：先 await metadata.load(dir) 再取模板或配置");
    }
  }

  function requireTemplate(name: string): TemplateTable {
    requireLoaded();
    const table = state.templates.get(name);
    if (table === undefined) {
      throw new Error(
        `没有 Template 表：${name}（sheet 名要原样、且以 ${TEMPLATE_SUFFIX} 结尾；已加载：${listOf(state.templates.keys())}）`,
      );
    }
    return table;
  }

  async function load(dir: string): Promise<MetadataReport> {
    const root = resolve(process.cwd(), dir);
    let files: string[];
    try {
      files = readdirSync(root)
        .filter((file) => SPREADSHEET_EXTENSIONS.some((ext) => file.endsWith(ext)))
        // 排序只为报错与日志稳定：同名 sheet 冲突时报哪个文件不该随机。
        .sort();
    } catch {
      throw new Error(`元数据目录不存在或读不了：${root}`);
    }

    const templates = new Map<string, TemplateTable>();
    const configs = new Map<string, Record<string, CellValue>>();
    const skipped: string[] = [];
    const source = new Map<string, string>();

    for (const file of files) {
      const path = join(root, file);
      const workbook = await loadWorkbook(path);
      for (const sheet of workbook.sheets) {
        const kind = classify(sheet.name);
        if (kind === null) {
          skipped.push(`${file}#${sheet.name}`);
          continue;
        }
        const seen = source.get(sheet.name);
        if (seen !== undefined) {
          // 同名 sheet 静默覆盖是 rim.proxy 的旧 bug，这里直接报错。
          throw new Error(
            `sheet 名重复：${sheet.name}（${seen} 与 ${file}）；第一层索引只能用 sheet 名，必须唯一`,
          );
        }
        source.set(sheet.name, file);
        if (kind === "template") {
          templates.set(sheet.name, toTemplateTable(path, sheet.name, sheet.rows));
        } else {
          configs.set(sheet.name, toConfig(path, sheet.name, sheet.rows));
        }
      }
    }

    // 全部成功才替换：半加载状态会让下一次 load 读到混合数据。
    state.loaded = true;
    state.templates = templates;
    state.configs = configs;

    return {
      templates: [...templates.keys()],
      configs: [...configs.keys()],
      skipped,
    };
  }

  function template<T extends Record<string, unknown>>(name: string): Template<T> {
    return {
      name,
      get(id: number): T | undefined {
        return requireTemplate(name).byId.get(id) as T | undefined;
      },
      all(): readonly T[] {
        return requireTemplate(name).list as readonly T[];
      },
    };
  }

  function config<T extends Record<string, unknown>>(name: string): Config<T> {
    return {
      name,
      get(): T {
        requireLoaded();
        const value = state.configs.get(name);
        if (value === undefined) {
          throw new Error(
            `没有 Config 表：${name}（sheet 名要原样、且以 ${CONFIG_SUFFIX} 结尾；已加载：${listOf(state.configs.keys())}）`,
          );
        }
        return value as T;
      },
    };
  }

  return { load, template, config };
}
