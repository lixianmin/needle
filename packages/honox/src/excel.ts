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

/** 拆列的默认分隔符：配置表里 `503048|508012|0|0` 这种形态。 */
const SPLIT_SEPARATOR = "|";

/**
 * 拆列的声明，两种写法：
 * - `["equips", "tags"]`：这些列按默认分隔符 `|` 拆；
 * - `{ equips: "|", tags: "," }`：逐列指定分隔符（写 `""` 等同默认）。
 *
 * TS 没有 Go 那样的 struct tag，运行时也没有类型信息，所以分隔符只能这样
 * 跟句柄一起声明——位置就是 `app/md/<名>-template.ts` 里那一行。
 */
export type SplitColumns = readonly string[] | Readonly<Record<string, string>>;

export interface TemplateOptions {
  /**
   * 这些列在读取时拆成 `string[]`。
   *
   * 不拆的话业务侧每次都得自己 `split("|")`，还得处理空单元格；
   * 拆列结果里 `"0"` 保留（它是有含义的占位），空单元格是 `[]`。
   */
  readonly split?: SplitColumns;
}

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
  template<T extends Record<string, unknown>>(name: string, options?: TemplateOptions): Template<T>;
  /** 按 sheet 名取一个 Config 句柄；真正的数据在 load() 之后可读。 */
  config<T extends Record<string, unknown>>(name: string, options?: TemplateOptions): Config<T>;
}

interface TemplateTable {
  readonly byId: ReadonlyMap<number, Record<string, CellValue>>;
  readonly list: readonly Record<string, CellValue>[];
}

interface State {
  loaded: boolean;
  /** 每次 load() 成功 +1；句柄据此丢弃缓存的行视图。 */
  version: number;
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

/**
 * 归一成 列名 → 分隔符 的表。列名按小写比较（表头在 toRecords 里已经 lowercase 了），
 * 分隔符写空字符串时退回默认的 `|`。
 */
function normalizeSplit(split: SplitColumns | undefined): ReadonlyMap<string, string> {
  const columns = new Map<string, string>();
  if (split === undefined) {
    return columns;
  }
  if (Array.isArray(split)) {
    for (const column of split) {
      columns.set(column.trim().toLowerCase(), SPLIT_SEPARATOR);
    }
    return columns;
  }
  for (const [column, separator] of Object.entries(split)) {
    columns.set(column.trim().toLowerCase(), separator === "" ? SPLIT_SEPARATOR : separator);
  }
  return columns;
}

/**
 * 按各列的分隔符拆列：`"a|b|0"` → `["a", "b", "0"]`。
 * 空单元格给 `[]`；列名写错（表里没这列）就不动它，避免造出幽灵字段。
 */
function applySplit(
  row: Record<string, CellValue>,
  columns: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const shaped: Record<string, unknown> = { ...row };
  for (const [column, separator] of columns) {
    if (!(column in shaped)) {
      continue;
    }
    const value = row[column];
    shaped[column] =
      value === null || value === undefined || value === ""
        ? []
        : String(value)
            .split(separator)
            .map((part) => part.trim());
  }
  return shaped;
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
  const state: State = { loaded: false, version: 0, templates: new Map(), configs: new Map() };

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
    state.version += 1;
    state.templates = templates;
    state.configs = configs;

    return {
      templates: [...templates.keys()],
      configs: [...configs.keys()],
      skipped,
    };
  }

  function template<T extends Record<string, unknown>>(
    name: string,
    options: TemplateOptions = {},
  ): Template<T> {
    const columns = normalizeSplit(options.split);
    let cachedVersion = -1;
    let byId: ReadonlyMap<number, T> = new Map();
    let list: readonly T[] = [];

    /**
     * 拆列视图按句柄缓存：同一张表可以有几个句柄各写各的 split。
     * version 变了（重新 load）就重建，避免拿到上一份数据的视图。
     */
    function view(): { byId: ReadonlyMap<number, T>; list: readonly T[] } {
      const table = requireTemplate(name);
      if (cachedVersion === state.version) {
        return { byId, list };
      }
      if (columns.size === 0) {
        byId = table.byId as ReadonlyMap<number, T>;
        list = table.list as readonly T[];
      } else {
        const shaped = table.list.map((row) => applySplit(row, columns) as T);
        // id 在 toTemplateTable 里已经校验成数字，这里只是从视图里取回来当 key。
        byId = new Map(
          shaped.map((row) => [(row as unknown as { id: number }).id, row] as const),
        );
        list = shaped;
      }
      cachedVersion = state.version;
      return { byId, list };
    }

    return {
      name,
      get(id: number): T | undefined {
        return view().byId.get(id);
      },
      all(): readonly T[] {
        return view().list;
      },
    };
  }

  function config<T extends Record<string, unknown>>(
    name: string,
    options: TemplateOptions = {},
  ): Config<T> {
    const columns = normalizeSplit(options.split);
    let cachedVersion = -1;
    let shaped: T | undefined;

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
        if (cachedVersion !== state.version) {
          shaped = (columns.size === 0 ? value : applySplit(value, columns)) as T;
          cachedVersion = state.version;
        }
        return shaped as T;
      },
    };
  }

  return { load, template, config };
}
