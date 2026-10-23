import { complete, runLocal } from "./commands.js";
import { writeHistory } from "./history.js";
import { renderOutput } from "./output.js";
export function enterPasswordMode(ctx, user) {
    ctx.state.pendingUser = user;
    ctx.input.type = "password";
    ctx.input.value = "";
    ctx.input.placeholder = "密码（输入不回显）";
    ctx.input.focus();
    ctx.sink.pushText("密码:", "echo");
}
export function leavePasswordMode(ctx) {
    ctx.state.pendingUser = null;
    ctx.input.type = "text";
    ctx.input.placeholder = "";
    ctx.input.value = "";
}
/** 密码这一步：不回显、不进历史、不发命令，只走 authenticate。 */
function submitPassword(ctx) {
    const password = ctx.input.value;
    const target = ctx.state.pendingUser ?? "";
    leavePasswordMode(ctx);
    if (password === "") {
        return;
    }
    void ctx.adapter.authenticate(target, password).then((result) => {
        if (result.ok) {
            ctx.state.loggedIn = true;
            ctx.sink.pushText(`已登录：${result.user}`, "status");
        }
        else {
            ctx.sink.pushText(result.error, "status");
        }
    }, 
    // 网络断开 / 网关塞了一页 HTML：不接 reject 的话这里完全没有提示。
    (error) => ctx.sink.pushText(`登录请求失败：${String(error)}`, "status"));
}
function submitCommand(ctx) {
    const line = ctx.input.value.trim();
    if (line === "") {
        return;
    }
    ctx.input.value = "";
    const [name, ...args] = line.split(/\s+/);
    if (name === undefined) {
        return;
    }
    ctx.sink.pushText(`$ ${line}`, "echo");
    remember(ctx, line);
    const handled = runLocal(name, args, {
        state: ctx.state,
        pushText: ctx.sink.pushText,
        applySubscriptions: ctx.applySubscriptions,
        enterPasswordMode: (user) => {
            enterPasswordMode(ctx, user);
        },
    });
    if (handled) {
        return;
    }
    void ctx.adapter.exec(line).then((result) => {
        renderOutput(result, ctx.sink, ctx.table);
    }, (error) => ctx.sink.pushText(`请求失败：${String(error)}`, "status"));
}
function remember(ctx, line) {
    ctx.state.history.push(line);
    ctx.state.cursor = ctx.state.history.length;
    writeHistory(ctx.state.history);
}
/** 表单提交：要么是密码，要么是一条命令。 */
export function wireForm(ctx) {
    ctx.form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (ctx.state.pendingUser !== null) {
            submitPassword(ctx);
            return;
        }
        submitCommand(ctx);
    });
}
/** 输入框的键盘：Esc 取消密码、Tab 补全、上下翻历史。 */
export function wireKeys(ctx) {
    ctx.input.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && ctx.state.pendingUser !== null) {
            event.preventDefault();
            leavePasswordMode(ctx);
            ctx.sink.pushText("已取消", "status");
            return;
        }
        // Tab 补全：永远 preventDefault，否则焦点会跳到别的控件上。
        if (event.key === "Tab") {
            event.preventDefault();
            if (!event.shiftKey && ctx.state.pendingUser === null) {
                complete(ctx.input, {
                    commands: ctx.state.commands,
                    topics: ctx.state.topics,
                    pushText: ctx.sink.pushText,
                });
            }
            return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
            return;
        }
        // 密码框里翻历史会把上一条命令当密码提交，用户还看不出发生了什么。
        if (ctx.state.pendingUser !== null) {
            return;
        }
        if (ctx.state.history.length === 0) {
            return;
        }
        event.preventDefault();
        ctx.state.cursor =
            event.key === "ArrowUp"
                ? Math.max(0, ctx.state.cursor - 1)
                : Math.min(ctx.state.history.length, ctx.state.cursor + 1);
        ctx.input.value = ctx.state.history[ctx.state.cursor] ?? "";
    });
}
/**
 * 回车抢焦点。
 *
 * 控制台的用法是"随时开始敲命令"，而不是"先精确点中那个输入框"。焦点在
 * 页面空白处或输出区时按回车，直接把光标送进输入框——省掉一次鼠标移动。
 * 焦点已经在别的输入控件里（页面里可能嵌着业务表单）就不抢。
 */
export function wireEnterFocus(doc, input) {
    function isEditable(node) {
        if (node === null) {
            return false;
        }
        const tag = node.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") {
            return true;
        }
        return node.isContentEditable === true;
    }
    const focusOnEnter = (event) => {
        if (event.key !== "Enter") {
            return;
        }
        if (isEditable(doc.activeElement)) {
            return;
        }
        // Enter 是按钮/链接的默认激活方式，抢走它键盘就没法操作控制台自己的控件。
        if (doc.activeElement?.closest?.("button, a, [role='button']") != null) {
            return;
        }
        event.preventDefault();
        input.focus();
    };
    doc.addEventListener("keydown", focusOnEnter);
    return () => {
        doc.removeEventListener("keydown", focusOnEnter);
    };
}
