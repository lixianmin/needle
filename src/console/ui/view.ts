import { displayNumber, formatDuration, toHuman } from "../../core/human.js";
import type { LogRecord } from "../../core/types.js";
import type { ColumnFormat, CommandOutput } from "../types.js";
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

/** 主题行的人话格式：字节走 toHuman，毫秒转秒，比率原样。 */
function formatMetric(key: string, value: unknown): string {
  if (typeof value !== "number") {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? "";
  }
  if (key === "rss" || key === "heapUsed") return toHuman(value);
  // 约定：以 Ms 结尾的字段是毫秒数（uptimeMs、latencyMs…），按时长渲染。
  if (key.endsWith("Ms")) return formatDuration(value);
  return displayNumber(value);
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
  const title = el(doc, "span", "title");
  title.textContent = "console";
  const version = el(doc, "span", "version");
  const user = el(doc, "span", "who");
  user.textContent = "未登录";
  header.append(title, version, user);

  const output = el(doc, "div", "output");
  const form = el(doc, "form");
  const prompt = el(doc, "span", "prompt");
  prompt.textContent = "$";
  const input = el(doc, "input");
  input.setAttribute("aria-label", "命令");
  input.autocomplete = "off";
  form.append(prompt, input);

  wrap.append(header, output, form);
  root.append(wrap);

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

  function table(
    columns: string[],
    rows: Array<Array<string | number | null>>,
    formats: ColumnFormat[] = [],
  ): HTMLElement {
    const grid = el(doc, "table", "grid");
    const head = el(doc, "thead");
    const headRow = el(doc, "tr");
    const body = el(doc, "tbody");

    const render = (format: ColumnFormat, value: string | number | null): string => {
      if (value === null) return "";
      if (typeof value !== "number") return String(value);
      if (format === "duration") return formatDuration(value);
      if (format === "bytes") return toHuman(value);
      if (format === "number") return String(value);
      return displayNumber(value);
    };

    const show = (index: number, value: string | number | null): string =>
      render(formats[index] ?? "auto", value);

    const renderBody = (sorted: Array<Array<string | number | null>>): void => {
      body.replaceChildren();
      for (const row of sorted) {
        const tr = el(doc, "tr");
        row.forEach((value, index) => {
          const cell = el(doc, "td");
          cell.textContent = show(index, value);
          tr.append(cell);
        });
        body.append(tr);
      }
    };

    // 表头点击排序，跟 gonsole 的 JsonTable 一个交互：再点一次反向。
    let sortIndex = -1;
    let direction = 1;

    const headers = columns.map((column, index) => {
      const cell = el(doc, "th");
      cell.textContent = column;
      cell.classList.add("sortable");
      cell.addEventListener("click", () => {
        if (sortIndex === index) direction = -direction;
        else {
          sortIndex = index;
          direction = 1;
        }
        const sorted = [...rows].sort(
          (left, right) => compare(left[index] ?? null, right[index] ?? null) * direction,
        );
        renderBody(sorted);
        headers.forEach((header, i) => {
          const base = columns[i] ?? "";
          header.textContent = i === sortIndex ? `${base} ${direction === 1 ? "▲" : "▼"}` : base;
        });
      });
      headRow.append(cell);
      return cell;
    });

    renderBody(rows);
    head.append(headRow);
    grid.append(head, body);
    return grid;
  }

  /** 数字按数值比大小，其余按字符串；空值永远排在最后。 */
  function compare(left: string | number | null, right: string | number | null): number {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right));
  }

  function renderOutput(result: ExecResult): void {
    if (!result.ok) {
      pushText(result.unauthorized === true ? "未登录：先执行 auth <user>" : result.error, "status");
      return;
    }

    const value: CommandOutput = result.output;
    if (value.kind === "text") {
      for (const line of value.text.split("\n")) pushText(line);
      return;
    }
    if (value.kind === "table") {
      push(table(value.columns, value.rows, value.formats));
      return;
    }
    pushText(JSON.stringify(value.value, null, 2), "raw");
  }

  /** 主题推送落成一行：`[top] rss=36.3MB heap=1.6MB …`。不常驻面板。 */
  function renderTopic(name: string, data: unknown): void {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      pushText(`[${name}] ${JSON.stringify(data)}`, "topic-line");
      return;
    }

    const pairs = Object.entries(data as Record<string, unknown>).map(
      ([key, value]) => `${key}=${formatMetric(key, value)}`,
    );
    pushText(`[${name}] ${pairs.join("  ")}`, "topic-line");
  }

  // ---- 订阅状态（属于这条流，由 UI 维护） ----
  const subscriptions = new Map<string, number | undefined>();
  let availableTopics: Array<{ name: string; intervalMs: number }> = [];
  let availableCommands: Array<{ name: string; note: string; args: string | null }> = [];

  /** 控制台自己的命令，不在服务端命令表里也照样能补全。 */
  const LOCAL_COMMANDS = ["auth", "logout", "sub", "unsub"] as const;

  function topicSpec(): string {
    return [...subscriptions.entries()]
      .map(([name, interval]) => (interval === undefined ? name : `${name}:${interval}`))
      .join(",");
  }

  function applySubscriptions(): void {
    adapter.setTopics(topicSpec());
  }

  const unsubscribe = adapter.subscribe((event: ConsoleEvent) => {
    switch (event.type) {
      case "handshake":
        // 头栏显示"谁的控制台"：项目名 + 版本 + 当前账号，全部靠左。
        title.textContent = event.info.title;
        version.textContent = `v${event.info.version}`;
        user.textContent = event.info.user ?? "未登录";
        availableTopics = event.info.topics;
        availableCommands = event.info.commands;
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

  /** 正在等密码的账号。非空时下一次回车的内容当密码处理。 */
  let pendingUser: string | null = null;

  function enterPasswordMode(nextUser: string): void {
    pendingUser = nextUser;
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

  function commonPrefix(values: string[]): string {
    if (values.length === 0) return "";
    let prefix = values[0] ?? "";
    for (const value of values) {
      while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return prefix;
  }

  function commandNames(prefix: string): string[] {
    const names = new Set(availableCommands.map((command) => command.name));
    for (const name of LOCAL_COMMANDS) names.add(name);
    return [...names].filter((name) => name.startsWith(prefix)).sort();
  }

  function topicNames(prefix: string): string[] {
    return availableTopics
      .map((topic) => topic.name)
      .filter((name) => name.startsWith(prefix))
      .sort();
  }

  /**
   * Tab 补全。
   *
   * 只看行尾补全（控制台里 Tab 基本都在行尾按），这样不用跟 selectionStart
   * 的浏览器差异打交道。命令名来自服务端的 handshake，所以用户在服务器上
   * 自定义的命令一样能被补全；`sub`/`unsub` 的第二个词补主题名。
   */
  function complete(): void {
    const tokens = input.value.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? "";
    const pool =
      tokens.length === 1
        ? commandNames(last)
        : tokens[0] === "sub" || tokens[0] === "unsub"
          ? topicNames(last)
          : [];

    if (pool.length === 0) return;

    if (pool.length === 1) {
      const before = tokens.slice(0, -1).join(" ");
      input.value = `${before === "" ? "" : `${before} `}${pool[0]} `;
      return;
    }

    const prefix = commonPrefix(pool);
    if (prefix.length > last.length) {
      const before = tokens.slice(0, -1).join(" ");
      input.value = `${before === "" ? "" : `${before} `}${prefix}`;
      return;
    }

    pushText(`候选: ${pool.join("  ")}`, "status");
  }

  const history = readHistory();
  let cursor = history.length;

  function remember(line: string): void {
    history.push(line);
    writeHistory(history);
    cursor = history.length;
  }

  /** 本地命令：不发 /exec，因为它们要么属于这条连接，要么属于浏览器。 */
  function runLocal(name: string, args: string[]): boolean {
    switch (name) {
      case "auth": {
        const target = args[0];
        if (target === undefined) {
          pushText("用法: auth <user>", "status");
          return true;
        }
        enterPasswordMode(target);
        return true;
      }

      case "logout":
        adapter.logout();
        pushText("已退出", "status");
        return true;

      case "sub": {
        const topic = args[0];
        if (topic === undefined) {
          pushText(
            `用法: sub <topic> [interval-ms]，可订阅：${availableTopics.map((item) => item.name).join(" ") || "（无）"}`,
            "status",
          );
          return true;
        }
        if (availableTopics.length > 0 && !availableTopics.some((item) => item.name === topic)) {
          pushText(`没有这个主题：${topic}`, "status");
          return true;
        }
        const interval = args[1] === undefined ? undefined : Number(args[1]);
        if (interval !== undefined && !Number.isFinite(interval)) {
          pushText("interval-ms 必须是数字", "status");
          return true;
        }
        subscriptions.set(topic, interval);
        applySubscriptions();
        pushText(`已订阅 ${topic}`, "status");
        return true;
      }

      case "unsub": {
        const topic = args[0];
        if (topic === undefined) {
          subscriptions.clear();
          applySubscriptions();
          pushText("已取消全部订阅", "status");
          return true;
        }
        if (!subscriptions.delete(topic)) {
          pushText(`没订阅过 ${topic}`, "status");
          return true;
        }
        applySubscriptions();
        pushText(`已取消订阅 ${topic}`, "status");
        return true;
      }

      default:
        return false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    // 密码这一步：不回显、不进历史、不发命令，只走 authenticate。
    if (pendingUser !== null) {
      const password = input.value;
      const target = pendingUser;
      leavePasswordMode();
      if (password === "") return;

      void adapter.authenticate(target, password).then((result) => {
        if (result.ok) pushText(`已登录：${result.user}`, "status");
        else pushText(result.error, "status");
      });
      return;
    }

    const line = input.value.trim();
    if (line === "") return;
    input.value = "";

    const [name, ...args] = line.split(/\s+/);
    if (name === undefined) return;

    pushText(`$ ${line}`, "echo");
    remember(line);

    if (runLocal(name, args)) return;
    void adapter.exec(line).then(renderOutput);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pendingUser !== null) {
      event.preventDefault();
      leavePasswordMode();
      pushText("已取消", "status");
      return;
    }
    // Tab 补全：永远 preventDefault，否则焦点会跳到别的控件上。
    if (event.key === "Tab") {
      event.preventDefault();
      if (!event.shiftKey && pendingUser === null) complete();
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
