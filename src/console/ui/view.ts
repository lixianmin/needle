import type { LogRecord } from "../../core/types.js";
import type { CommandOutput } from "../types.js";
import type { ConsoleAdapter, ConsoleEvent, ExecResult } from "./adapter.js";
import { STYLE, STYLE_ID } from "./style.js";

/** 输出区保留的最大行数。再多浏览器会开始卡，而且人也不会往回翻那么远。 */
const MAX_LINES = 500;
const HISTORY_KEY = "logo.console.history";
const HISTORY_LIMIT = 50;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  doc.head.append(style);
}

function clock(time: number): string {
  const date = new Date(time);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    // 隐私模式、扩展沙箱里 localStorage 可能直接抛错。历史记录丢了不算故障。
    return [];
  }
}

function writeHistory(lines: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(lines.slice(-HISTORY_LIMIT)));
  } catch {
    /* 同上，忽略 */
  }
}

export interface ConsoleView {
  dispose(): void;
}

/**
 * 把控制台挂到一个 DOM 节点上。
 *
 * 用 DOM API 而不是 innerHTML：日志内容是外部数据，拼字符串就得自己防注入；
 * 更重要的是 Chrome 扩展的 CSP 不允许内联脚本，DOM 构建这条路在哪都能走。
 */
export function mountConsole(root: HTMLElement, adapter: ConsoleAdapter): ConsoleView {
  const doc = root.ownerDocument;
  injectStyle(doc);

  const wrap = el(doc, "div", "logo-console");
  const header = el(doc, "header");
  const title = el(doc, "span");
  title.textContent = "logo";
  const user = el(doc, "span", "who");
  user.textContent = "未登录";
  header.append(title, user);

  const output = el(doc, "div", "output");
  const topics = el(doc, "div", "topics");
  const form = el(doc, "form");
  const prompt = el(doc, "span", "prompt");
  prompt.textContent = "$";
  const input = el(doc, "input");
  input.setAttribute("aria-label", "命令");
  input.autocomplete = "off";
  form.append(prompt, input);

  wrap.append(header, output, topics, form);
  root.append(wrap);

  const topicPanels = new Map<string, HTMLElement>();

  function push(node: HTMLElement): void {
    output.append(node);
    while (output.childElementCount > MAX_LINES) output.firstElementChild?.remove();
    output.scrollTop = output.scrollHeight;
  }

  function pushText(text: string, className?: string): void {
    const line = el(doc, "div", className);
    line.textContent = text;
    push(line);
  }

  function renderLog(record: LogRecord): void {
    const line = el(doc, "div", "line");
    const time = el(doc, "span", "t");
    time.textContent = clock(record.time);
    const level = el(doc, "span", `lv lv-${record.level}`);
    level.textContent = record.level;
    const msg = el(doc, "span", "msg");
    msg.textContent = record.msg ?? "";
    line.append(time, level, msg);
    push(line);
  }

  function table(columns: string[], rows: Array<Array<string | number | null>>): HTMLElement {
    const grid = el(doc, "table", "grid");
    const head = el(doc, "tr");
    for (const column of columns) {
      const cell = el(doc, "th");
      cell.textContent = column;
      head.append(cell);
    }
    grid.append(head);

    for (const row of rows) {
      const tr = el(doc, "tr");
      for (const value of row) {
        const cell = el(doc, "td");
        cell.textContent = value === null ? "" : String(value);
        tr.append(cell);
      }
      grid.append(tr);
    }
    return grid;
  }

  function renderOutput(result: ExecResult): void {
    if (!result.ok) {
      pushText(result.unauthorized === true ? `未登录：先执行 login <user> <password>` : result.error, "status");
      return;
    }

    const outputValue: CommandOutput = result.output;
    if (outputValue.kind === "text") {
      for (const line of outputValue.text.split("\n")) pushText(line);
      return;
    }
    if (outputValue.kind === "table") {
      push(table(outputValue.columns, outputValue.rows));
      return;
    }
    pushText(JSON.stringify(outputValue.value, null, 2), "raw");
  }

  function renderTopic(name: string, data: unknown): void {
    let panel = topicPanels.get(name);
    if (panel === undefined) {
      panel = el(doc, "div", "topic");
      const heading = el(doc, "h3");
      heading.textContent = name;
      panel.append(heading);
      topics.append(panel);
      topicPanels.set(name, panel);
    }

    panel.querySelector("table")?.remove();
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const rows = Object.entries(data as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      ]);
      panel.append(table(["", ""], rows));
      return;
    }
    const pre = el(doc, "div");
    pre.textContent = JSON.stringify(data);
    panel.append(pre);
  }

  const unsubscribe = adapter.subscribe((event: ConsoleEvent) => {
    switch (event.type) {
      case "hello":
        title.textContent = `logo · v${event.info.version}`;
        user.textContent = event.info.user ?? "未登录";
        break;
      case "log":
        renderLog(event.record);
        break;
      case "topic":
        renderTopic(event.name, event.data);
        break;
      case "status":
        pushText(event.message, "status");
        break;
    }
  });

  /**
   * 回车抢焦点。
   *
   * 控制台的用法是"随时开始敲命令"，而不是"先精确点中那个输入框"。焦点在
   * 页面空白处或输出区时按回车，直接把光标送进输入框——省掉一次鼠标移动。
   * 焦点已经在别的输入控件里（页面里可能嵌着业务表单）就不抢。
   */
  function isEditable(node: Element | null): boolean {
    if (node === null) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return (node as HTMLElement).isContentEditable === true;
  }

  const focusOnEnter = (event: KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    if (isEditable(doc.activeElement)) return;
    event.preventDefault();
    input.focus();
  };

  doc.addEventListener("keydown", focusOnEnter);

  const history = readHistory();
  let cursor = history.length;

  /** 正在等密码的账号。非空时下一次回车的内容当密码处理。 */
  let pendingUser: string | null = null;

  function enterPasswordMode(user: string): void {
    pendingUser = user;
    input.type = "password";
    input.value = "";
    input.placeholder = "密码（输入不回显）";
    input.focus();
    pushText("密码:", "echo");
  }

  function leavePasswordMode(): void {
    pendingUser = null;
    input.type = "text";
    input.placeholder = "";
    input.value = "";
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    // 密码这一步：不回显、不进历史、不发命令，只走 authenticate。
    if (pendingUser !== null) {
      const password = input.value;
      const user = pendingUser;
      leavePasswordMode();
      if (password === "") return;

      void adapter.authenticate(user, password).then((result) => {
        if (result.ok) pushText(`已登录：${result.user}`, "status");
        else pushText(result.error, "status");
      });
      return;
    }

    const line = input.value.trim();
    if (line === "") return;

    input.value = "";

    // auth 与 logout 是控制台自己的动作，不发给服务端。
    const [name, ...args] = line.split(/\s+/);
    if (name === "auth") {
      const user = args[0];
      if (user === undefined) {
        pushText("用法: auth <user>", "status");
        return;
      }
      history.push(line);
      writeHistory(history);
      cursor = history.length;
      pushText(`$ ${line}`, "echo");
      enterPasswordMode(user);
      return;
    }

    if (name === "logout") {
      adapter.logout();
      pushText("已退出", "status");
      return;
    }

    history.push(line);
    writeHistory(history);
    cursor = history.length;

    pushText(`$ ${line}`, "echo");
    void adapter.exec(line).then(renderOutput);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pendingUser !== null) {
      event.preventDefault();
      leavePasswordMode();
      pushText("已取消", "status");
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (history.length === 0) return;

    event.preventDefault();
    cursor = event.key === "ArrowUp" ? Math.max(0, cursor - 1) : Math.min(history.length, cursor + 1);
    input.value = history[cursor] ?? "";
  });

  return {
    dispose() {
      doc.removeEventListener("keydown", focusOnEnter);
      unsubscribe();
      wrap.remove();
    },
  };
}
