/**
 * Solarized Dark（Ethan Schoonover 的配色），不自己调色。
 *
 * 插到文档里一次，用 id 判重——一个页面里挂多个 Shell 面板时不至于
 * 把同一份样式重复注入几十遍。
 */
export const STYLE_ID = "logo-shell-style";

export const STYLE = `
.logo-shell {
  --bg: #002b36; --bg-alt: #073642; --dim: #586e75; --text: #839496;
  --text-strong: #93a1a1; --cyan: #2aa198; --yellow: #b58900;
  --red: #dc322f; --blue: #268bd2; --line: rgba(147,161,161,0.18);
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--bg); color: var(--text);
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.logo-shell * { box-sizing: border-box; }
.logo-shell header {
  display: flex; gap: 12px; align-items: baseline;
  padding: 8px 12px; background: var(--bg-alt); color: var(--text-strong);
  border-bottom: 1px solid var(--line);
}
.logo-shell header .title { color: var(--text-strong); }
.logo-shell header .version { color: var(--dim); }
.logo-shell header .who { color: var(--cyan); }
.logo-shell .output { flex: 1; overflow-y: auto; padding: 8px 12px; white-space: pre-wrap; }
.logo-shell .echo { color: var(--blue); }
.logo-shell .status { color: var(--yellow); }
.logo-shell .topic-line { color: var(--dim); }
.logo-shell .topic-line::first-line { color: var(--dim); }
.logo-shell form {
  display: flex; gap: 8px; align-items: center;
  padding: 8px 12px; background: var(--bg-alt); border-top: 1px solid var(--line);
}
.logo-shell form .prompt { color: var(--cyan); }
.logo-shell input {
  flex: 1; background: transparent; border: 0; outline: none;
  color: var(--text-strong); font: inherit;
}

/* 表格要看得出来是表格：表头有线、行有斑马纹、单元格有留白 */
.logo-shell table.grid {
  border-collapse: collapse; margin: 4px 0 10px;
  border: 1px solid var(--line); background: var(--bg-alt);
}
.logo-shell table.grid th {
  text-align: left; font-weight: normal; color: var(--text-strong);
  padding: 3px 12px; background: rgba(147,161,161,0.08);
  border-bottom: 1px solid var(--line);
}
.logo-shell table.grid td {
  padding: 2px 12px; border-bottom: 1px solid rgba(147,161,161,0.08);
  vertical-align: top; white-space: nowrap;
}
.logo-shell table.grid th.sortable { cursor: pointer; user-select: none; }
.logo-shell table.grid th .mark { margin-left: 6px; color: var(--dim); opacity: .55; }
.logo-shell table.grid th:hover .mark { opacity: 1; }
.logo-shell table.grid th .mark.active { color: var(--cyan); opacity: 1; }
.logo-shell table.grid th.sortable:hover { background: rgba(38,139,210,0.16); }
.logo-shell table.grid tbody tr:last-child td { border-bottom: 0; }
.logo-shell table.grid tbody tr:nth-child(even) { background: rgba(147,161,161,0.04); }
.logo-shell table.grid tbody tr:hover { background: rgba(38,139,210,0.12); }

/* 文件名 hover 的末尾样本提示：结构与 GONSOLE 同款，配色走 Solarized 变量 */
.logo-shell .tips { position: relative; display: inline-block; }
.logo-shell .tips .tips_text {
  /* 纯文本样本，\n 换行要保留 */
  visibility: hidden; white-space: pre-wrap;
  position: absolute; z-index: 1; top: -5px; left: 105%;
  min-width: 280px; max-width: 560px;
  background: var(--bg-alt); color: var(--text-strong);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px;
}
.logo-shell .tips:hover .tips_text { visibility: visible; }
.logo-shell .raw { color: var(--text-strong); }
/* 左右两栏：左栏执行区，右栏日志 / 主题 */
.logo-shell { position: relative; }
.logo-shell .body { display: flex; flex: 1; min-height: 0; }
.logo-shell .main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.logo-shell .side {
  display: flex; flex-direction: column; width: 38%; min-width: 260px; min-height: 0;
  border-left: 1px solid var(--line);
}
.logo-shell .tabs { display: flex; gap: 4px; padding: 6px 12px 0; border-bottom: 1px solid var(--line); }
.logo-shell .tab {
  background: transparent; border: 0; border-bottom: 2px solid transparent;
  color: var(--dim); font: inherit; cursor: pointer; padding: 3px 10px;
}
.logo-shell .tab.active { color: var(--cyan); border-bottom-color: var(--cyan); }
.logo-shell .panel { display: none; flex: 1; min-height: 0; flex-direction: column; }
.logo-shell .panel.active { display: flex; }
.logo-shell .tools {
  display: flex; gap: 8px; align-items: center;
  padding: 5px 12px; border-bottom: 1px solid var(--line); color: var(--dim);
}
.logo-shell .tool {
  background: transparent; border: 1px solid var(--line); color: var(--text);
  font: inherit; cursor: pointer; padding: 0 8px;
}
.logo-shell .tool.on { color: var(--yellow); border-color: var(--yellow); }
.logo-shell .dropped { margin-left: auto; color: var(--yellow); }

/* 变高虚拟列表：行高由 loglist.ts 实测，普通行就是 ROW_HEIGHT（18px） */
.logo-shell .list { position: relative; flex: 1; min-height: 0; overflow: auto; }
.logo-shell .spacer { position: relative; }
.logo-shell .row { position: absolute; left: 0; right: 0; }
.logo-shell .row .head {
  height: 18px; line-height: 18px; padding: 0 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.logo-shell .row .t { color: var(--dim); margin-right: 8px; }
.logo-shell .row .lv-debug { color: var(--dim); }
.logo-shell .row .lv-info { color: var(--text); }
.logo-shell .row .lv-warn { color: var(--yellow); }
.logo-shell .row .lv-error { color: var(--red); }

/* error 行里的调用栈：缩进、折行，整段跟着行一起滚 */
.logo-shell .row .stack {
  margin: 0; padding: 0 12px 4px 24px;
  white-space: pre-wrap; word-break: break-word;
  color: var(--dim); font: inherit; font-size: 12px; line-height: 16px;
}

.logo-shell .toggle {
  display: none; margin-left: auto; background: transparent; border: 1px solid var(--line);
  color: var(--text); font: inherit; cursor: pointer; padding: 0 8px;
}

/* 窄屏：右栏收起来，按钮把它盖满整个面板 */
@media (max-width: 720px) {
  .logo-shell .side { display: none; }
  .logo-shell .side.open { display: flex; position: absolute; inset: 0; width: 100%; min-width: 0; background: var(--bg); border-left: 0; }
  .logo-shell .toggle { display: inline-block; }
}
`;
