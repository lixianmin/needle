import { LEVELS } from "@needle/logo";
import { injectStyle } from "./dom.js";
import { readHistory } from "./history.js";
import { wireEnterFocus, wireForm, wireKeys } from "./input.js";
import { buildLayout } from "./layout.js";
import { estimateLogHeight, renderLogLine, renderTopicLine } from "./lines.js";
import { createLogList } from "./loglist.js";
import { createOutputSink } from "./output.js";
import { mountResizer } from "./resizer.js";
import { createState, topicSpec } from "./state.js";
import { createTableRenderer } from "./table.js";
/**
 * 把 Shell 挂到一个 DOM 节点上。
 *
 * 用 DOM API 而不是 innerHTML：日志内容是外部数据，拼字符串就得自己防注入；
 * 更重要的是 Chrome 扩展的 CSP 不允许内联脚本，DOM 构建这条路在哪都能走。
 *
 * 这个函数只负责「拼 DOM + 接线」：各块行为都在同目录的小模块里
 * （layout / lines / table / output / commands / input），改一处不用读全文。
 */
export function mountShell(root, adapter) {
    const doc = root.ownerDocument;
    injectStyle(doc);
    const ui = buildLayout(doc);
    const logList = createLogList(doc, (record) => renderLogLine(doc, record), {
        estimate: estimateLogHeight,
    });
    const topicList = createLogList(doc, (topic) => renderTopicLine(doc, topic), {
        capacity: 2000,
    });
    ui.logPanel.append(ui.tools, logList.el);
    ui.topicPanel.append(topicList.el);
    root.append(ui.wrap);
    const state = createState(readHistory());
    const sink = createOutputSink(doc, ui.output);
    const table = createTableRenderer(doc, (href) => {
        void openFile(doc, adapter, sink, href);
    });
    const updateDropped = () => {
        const total = logList.dropped() + state.pausedDropped;
        ui.droppedLabel.textContent = total > 0 ? `丢弃 ${total}` : "";
    };
    wireTabs(ui, logList, topicList);
    wireToolbar(ui, state, logList, updateDropped);
    const resizer = mountResizer({ pane: ui.aside, handle: ui.resizer });
    const unsubscribe = adapter.subscribe((event) => {
        handleEvent(event, { ui, state, logList, topicList, sink, updateDropped });
    });
    const disposeFocus = wireInputArea({ doc, ui, adapter, sink, table, state });
    return {
        dispose() {
            disposeFocus();
            unsubscribe();
            resizer.dispose();
            logList.dispose();
            topicList.dispose();
            ui.wrap.remove();
        },
    };
}
/** 输入区（表单、键盘、回车抢焦点）的接线。 */
function wireInputArea(ctx) {
    const { doc, ui, adapter, sink, table, state } = ctx;
    const input = {
        input: ui.input,
        form: ui.form,
        adapter,
        sink,
        table,
        state,
        applySubscriptions: () => {
            adapter.setTopics(topicSpec(state.subscriptions));
        },
    };
    wireForm(input);
    wireKeys(input);
    return wireEnterFocus(doc, ui.input);
}
/** 切换左右两个 tab：日志 / 主题。 */
function wireTabs(ui, logList, topicList) {
    function selectTab(which) {
        ui.logTab.classList.toggle("active", which === "log");
        ui.topicTab.classList.toggle("active", which === "topic");
        ui.logPanel.classList.toggle("active", which === "log");
        ui.topicPanel.classList.toggle("active", which === "topic");
        (which === "log" ? logList : topicList).flush();
    }
    ui.logTab.addEventListener("click", () => {
        selectTab("log");
    });
    ui.topicTab.addEventListener("click", () => {
        selectTab("topic");
    });
    ui.toggle.addEventListener("click", () => {
        ui.aside.classList.toggle("open");
    });
}
/** 工具条：暂停、清空、级别过滤。 */
function wireToolbar(ui, state, logList, updateDropped) {
    ui.pause.addEventListener("click", () => {
        state.paused = !state.paused;
        ui.pause.textContent = state.paused ? "继续" : "暂停";
        ui.pause.classList.toggle("on", state.paused);
    });
    ui.clear.addEventListener("click", () => {
        logList.clear();
        state.pausedDropped = 0;
        updateDropped();
    });
    ui.level.addEventListener("change", () => {
        state.minLevel = ui.level.value;
    });
}
/** 处理服务端推来的事件。 */
function handleEvent(event, ctx) {
    const { ui, state, logList, topicList, sink } = ctx;
    switch (event.type) {
        case "handshake":
            // 头栏显示"谁的 Shell"：项目名 + 版本 + 当前账号，全部靠左。
            ui.title.textContent = event.info.title;
            ui.version.textContent = `v${event.info.version}`;
            ui.user.textContent = event.info.user ?? "未登录";
            state.commands = event.info.commands;
            state.topics = event.info.topics;
            state.loggedIn = event.info.user !== null;
            // 服务端的 /events 未登录会 401，所以这里的 handshake 一定带账号；
            // 未登录的提示由适配器的 401 分支给出。
            break;
        case "logs": {
            if (state.paused) {
                state.pausedDropped += event.records.length;
                ctx.updateDropped();
                break;
            }
            const floor = state.minLevel;
            logList.append(floor === "all"
                ? event.records
                : event.records.filter((record) => LEVELS[record.level] >= LEVELS[floor]));
            ctx.updateDropped();
            break;
        }
        case "topic":
            topicList.append([{ name: event.name, data: event.data }]);
            break;
        case "status":
            sink.pushText(event.message, "status");
            break;
    }
}
/** 点日志文件名：取回全文，用 blob 在新窗口打开（链接里不带凭证）。 */
async function openFile(doc, adapter, sink, href) {
    let result;
    try {
        result = await adapter.fetchFile(href);
    }
    catch (error) {
        // 网络断开 / 网关返回 HTML：不接 reject 就是一条静默的 unhandled rejection。
        sink.pushText(`打开文件失败：${String(error)}`, "status");
        return;
    }
    if (!result.ok) {
        sink.pushText(result.error, "status");
        return;
    }
    const page = doc.defaultView;
    if (page === null) {
        return;
    }
    if (typeof URL.createObjectURL !== "function") {
        // 极端环境（部分扩展沙箱）没有 blob URL：退化成带凭证的直连会 401，不如说清楚。
        sink.pushText("当前环境不支持在新窗口打开文件", "status");
        return;
    }
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    page.open(url, "_blank", "noopener");
    // 新窗口已经把内容读进内存，稍后回收即可，立刻 revoke 会让空白页。
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
