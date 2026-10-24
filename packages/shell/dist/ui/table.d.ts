import type { Cell, ColumnFormat } from "../types.js";
/** 渲染一张表：列名 + 行 + 每列的格式。 */
export type TableRenderer = (columns: string[], rows: Cell[][], formats?: ColumnFormat[]) => HTMLElement;
/**
 * 表格渲染器。
 *
 * `openFile` 由调用方给：日志文件这类链接不直接跳转，先取回内容再开 blob，
 * 免得凭证跟着链接跑出去。
 */
export declare function createTableRenderer(doc: Document, openFile: (href: string) => void): TableRenderer;
