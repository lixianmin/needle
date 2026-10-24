import { button, el } from "./dom.js";

/**Shell 用到的全部 DOM 节点。 */
export interface ShellLayout {
  wrap: HTMLElement;
  header: HTMLElement;
  title: HTMLElement;
  version: HTMLElement;
  user: HTMLElement;
  toggle: HTMLButtonElement;
  output: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  aside: HTMLElement;
  /** 压在左右分界线上的拖拽把手。 */
  resizer: HTMLElement;
  logTab: HTMLButtonElement;
  topicTab: HTMLButtonElement;
  tools: HTMLElement;
  pause: HTMLButtonElement;
  clear: HTMLButtonElement;
  level: HTMLSelectElement;
  droppedLabel: HTMLElement;
  logPanel: HTMLElement;
  topicPanel: HTMLElement;
}

interface HeaderParts {
  header: HTMLElement;
  title: HTMLElement;
  version: HTMLElement;
  user: HTMLElement;
  toggle: HTMLButtonElement;
}

function buildHeader(doc: Document): HeaderParts {
  const header = el(doc, "header");
  const title = el(doc, "span", "title");
  title.textContent = "shell";
  const version = el(doc, "span", "version");
  const user = el(doc, "span", "who");
  user.textContent = "未登录";
  header.append(title, version, user);
  // 窄屏时右栏默认收起，头栏那个按钮把它盖上来。
  const toggle = button(doc, "日志", "toggle");
  header.append(toggle);
  return { header, title, version, user, toggle };
}

interface OutputParts {
  output: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
}

function buildOutput(doc: Document): OutputParts {
  const output = el(doc, "div", "output");
  const form = el(doc, "form");
  const prompt = el(doc, "span", "prompt");
  prompt.textContent = "$";
  const input = el(doc, "input");
  input.setAttribute("aria-label", "命令");
  input.autocomplete = "off";
  form.append(prompt, input);
  return { output, form, input };
}

interface SidebarParts {
  aside: HTMLElement;
  logTab: HTMLButtonElement;
  topicTab: HTMLButtonElement;
  tools: HTMLElement;
  pause: HTMLButtonElement;
  clear: HTMLButtonElement;
  level: HTMLSelectElement;
  droppedLabel: HTMLElement;
  logPanel: HTMLElement;
  topicPanel: HTMLElement;
}

function buildSidebar(doc: Document): SidebarParts {
  // 右栏：日志与主题各一个 tab。日志量级和主题完全不是一个数量级，混在一起
  // 主题会被冲走，所以分开放。
  const aside = el(doc, "aside", "side");
  const tabs = el(doc, "div", "tabs");
  const logTab = button(doc, "日志", "tab active");
  const topicTab = button(doc, "主题", "tab");
  tabs.append(logTab, topicTab);

  const tools = el(doc, "div", "tools");
  const pause = button(doc, "暂停", "tool");
  const clear = button(doc, "清空", "tool");
  const level = el(doc, "select", "tool");
  for (const value of ["all", "info", "warn", "error"] as const) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = value === "all" ? "全部" : value;
    level.append(option);
  }
  const droppedLabel = el(doc, "span", "dropped");
  tools.append(pause, level, clear, droppedLabel);

  const logPanel = el(doc, "div", "panel active");
  const topicPanel = el(doc, "div", "panel");
  aside.append(tabs, logPanel, topicPanel);
  return { aside, logTab, topicTab, tools, pause, clear, level, droppedLabel, logPanel, topicPanel };
}

/** 拼出 Shell 的整棵 DOM（不含日志列表，那两块由 view 挂上去）。 */
export function buildLayout(doc: Document):ShellLayout {
  const head = buildHeader(doc);
  const out = buildOutput(doc);
  const side = buildSidebar(doc);

  const main = el(doc, "div", "main");
  main.append(out.output, out.form);

  // 分界线本身是个可操作元素：5px 的透明条压在 `.side` 的左边框上。
  // role=separator + tabindex 让它也能用方向键调（详见 resizer.ts）。
  const resizer = el(doc, "div", "resizer");
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "调整右栏宽度");
  resizer.tabIndex = 0;

  const body = el(doc, "div", "body");
  body.append(main, resizer, side.aside);

  const wrap = el(doc, "div", "logo-shell");
  wrap.append(head.header, body);

  return {
    wrap,
    header: head.header,
    title: head.title,
    version: head.version,
    user: head.user,
    toggle: head.toggle,
    output: out.output,
    form: out.form,
    input: out.input,
    aside: side.aside,
    resizer,
    logTab: side.logTab,
    topicTab: side.topicTab,
    tools: side.tools,
    pause: side.pause,
    clear: side.clear,
    level: side.level,
    droppedLabel: side.droppedLabel,
    logPanel: side.logPanel,
    topicPanel: side.topicPanel,
  };
}
