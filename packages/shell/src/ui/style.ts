/**
 * Solarized Dark（Ethan Schoonover 的配色），不自己调色。
 *
 * 插到文档里一次，用 id 判重——一个页面里挂多个控制台面板时不至于
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
.logo-shell .raw { color: var(--text-strong); }
`;
