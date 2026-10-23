import { button, el } from "./dom.js";
function buildHeader(doc) {
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
function buildOutput(doc) {
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
function buildSidebar(doc) {
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
    for (const value of ["all", "info", "warn", "error"]) {
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
export function buildLayout(doc) {
    const head = buildHeader(doc);
    const out = buildOutput(doc);
    const side = buildSidebar(doc);
    const main = el(doc, "div", "main");
    main.append(out.output, out.form);
    const body = el(doc, "div", "body");
    body.append(main, side.aside);
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
