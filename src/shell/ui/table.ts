import { displayNumber, formatDuration, toHuman } from "../../logo/index.js";
import type { Cell, ColumnFormat, LinkedCell } from "../types.js";
import { el } from "./dom.js";

/** 渲染一张表：列名 + 行 + 每列的格式。 */
export type TableRenderer = (columns: string[], rows: Cell[][], formats?: ColumnFormat[]) => HTMLElement;

function isLink(value: Cell): value is LinkedCell {
  return typeof value === "object" && value !== null;
}

function renderValue(format: ColumnFormat, value: Cell): string {
  if (value === null) {
    return "";
  }
  if (isLink(value)) {
    return value.text;
  }
  if (typeof value !== "number") {
    return String(value);
  }
  if (format === "duration") {
    return formatDuration(value);
  }
  if (format === "bytes") {
    return toHuman(value);
  }
  if (format === "number") {
    return String(value);
  }
  return displayNumber(value);
}

/** 数字按数值比大小，其余按文本；空值永远排在最后。 */
function compare(left: Cell | undefined, right: Cell | undefined): number {
  const a = left ?? null;
  const b = right ?? null;
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  const av = typeof a === "object" ? a.text : a;
  const bv = typeof b === "object" ? b.text : b;
  if (typeof av === "number" && typeof bv === "number") {
    return av - bv;
  }
  return String(av).localeCompare(String(bv));
}

function tableCell(
  doc: Document,
  value: Cell,
  index: number,
  formats: ColumnFormat[],
  openFile: (href: string) => void,
): HTMLTableCellElement {
  const cell = el(doc, "td");
  if (isLink(value)) {
    // 日志文件这类：不直接跳转，先带 header 取回内容再开 blob。
    // href 留着，悬停/右键复制地址仍然能用。
    const link = el(doc, "a");
    link.href = value.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = value.text;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openFile(value.href);
    });
    cell.append(link);
  } else {
    cell.textContent = renderValue(formats[index] ?? "auto", value);
  }
  return cell;
}

function renderTableBody(
  doc: Document,
  body: HTMLElement,
  rows: Cell[][],
  formats: ColumnFormat[],
  openFile: (href: string) => void,
): void {
  body.replaceChildren();
  for (const row of rows) {
    const tr = el(doc, "tr");
    row.forEach((value, index) => {
      tr.append(tableCell(doc, value, index, formats, openFile));
    });
    body.append(tr);
  }
}

/** 按第 index 列排序。空值永远排最后：乘以 direction 会让降序时它们跑到最前面。 */
function sortRows(rows: Cell[][], index: number, direction: number): Cell[][] {
  return [...rows].sort((left, right) => {
    const a = left[index] ?? null;
    const b = right[index] ?? null;
    if (a === null || b === null) {
      return a === null ? (b === null ? 0 : 1) : -1;
    }
    return compare(a, b) * direction;
  });
}

function updateSortMarks(headers: HTMLTableCellElement[], sortIndex: number, direction: number): void {
  headers.forEach((header, i) => {
    const mark = header.querySelector(".mark");
    if (mark === null) {
      return;
    }
    mark.textContent = i === sortIndex ? (direction === 1 ? "▲" : "▼") : "⇅";
    mark.classList.toggle("active", i === sortIndex);
  });
}

function headerCell(doc: Document, column: string, onSort: () => void): HTMLTableCellElement {
  const cell = el(doc, "th");
  cell.classList.add("sortable");
  const label = el(doc, "span", "col");
  label.textContent = column;
  const mark = el(doc, "span", "mark");
  // 常驻一个 ⇅，否则表头看起来就是普通文字，没人知道能点。
  mark.textContent = "⇅";
  cell.append(label, mark);
  cell.addEventListener("click", onSort);
  return cell;
}

/**
 * 表格渲染器。
 *
 * `openFile` 由调用方给：日志文件这类链接不直接跳转，先取回内容再开 blob，
 * 免得凭证跟着链接跑出去。
 */
export function createTableRenderer(doc: Document, openFile: (href: string) => void): TableRenderer {
  return (columns, rows, formats = []) => {
    const grid = el(doc, "table", "grid");
    const head = el(doc, "thead");
    const headRow = el(doc, "tr");
    const body = el(doc, "tbody");
    const headers: HTMLTableCellElement[] = [];
    let sortIndex = -1;
    let direction = 1;

    // 表头点击排序，跟 gonsole 的 JsonTable 一个交互：再点一次反向。
    function sortBy(index: number): void {
      if (sortIndex === index) {
        direction = -direction;
      } else {
        sortIndex = index;
        direction = 1;
      }
      renderTableBody(doc, body, sortRows(rows, index, direction), formats, openFile);
      updateSortMarks(headers, sortIndex, direction);
    }

    for (const [index, column] of columns.entries()) {
      const cell = headerCell(doc, column, () => {
        sortBy(index);
      });
      headers.push(cell);
      headRow.append(cell);
    }

    renderTableBody(doc, body, rows, formats, openFile);
    head.append(headRow);
    grid.append(head, body);
    return grid;
  };
}
