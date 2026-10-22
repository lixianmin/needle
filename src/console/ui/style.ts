/**
 * Solarized Dark（Ethan Schoonover 的配色），不自己调色。
 *
 * 插到文档里一次，用 id 判重——一个页面里挂多个控制台面板时不至于
 * 把同一份样式重复注入几十遍。
 */
export const STYLE_ID = "logo-console-style";

export const STYLE = `
.logo-console {
  --bg: #002b36; --bg-alt: #073642; --dim: #586e75; --text: #839496;
  --text-strong: #93a1a1; --cyan: #2aa198; --yellow: #b58900;
  --red: #dc322f; --blue: #268bd2;
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--bg); color: var(--text);
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.logo-console * { box-sizing: border-box; }
.logo-console header {
  display: flex; gap: 12px; align-items: baseline;
  padding: 8px 12px; background: var(--bg-alt); color: var(--text-strong);
  border-bottom: 1px solid rgba(147,161,161,0.15);
}
.logo-console header .who { margin-left: auto; color: var(--dim); }
.logo-console .output { flex: 1; overflow-y: auto; padding: 8px 12px; white-space: pre-wrap; }
.logo-console .line { display: flex; gap: 8px; }
.logo-console .line .t { color: var(--dim); flex: none; }
.logo-console .line .lv { flex: none; width: 44px; text-transform: uppercase; }
.logo-console .lv-debug { color: var(--dim); }
.logo-console .lv-info { color: var(--cyan); }
.logo-console .lv-warn { color: var(--yellow); }
.logo-console .lv-error { color: var(--red); }
.logo-console .msg { word-break: break-word; }
.logo-console .echo { color: var(--blue); }
.logo-console .status { color: var(--yellow); }
.logo-console .topics { padding: 0 12px 8px; display: flex; gap: 16px; flex-wrap: wrap; }
.logo-console .topic { background: var(--bg-alt); padding: 6px 10px; border-radius: 3px; }
.logo-console .topic h3 { margin: 0 0 4px; font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .08em; }
.logo-console .topic table { border-collapse: collapse; }
.logo-console .topic td { padding: 1px 8px 1px 0; }
.logo-console .topic td:first-child { color: var(--dim); }
.logo-console form {
  display: flex; gap: 8px; align-items: center;
  padding: 8px 12px; background: var(--bg-alt); border-top: 1px solid rgba(147,161,161,0.15);
}
.logo-console form .prompt { color: var(--cyan); }
.logo-console input {
  flex: 1; background: transparent; border: 0; outline: none;
  color: var(--text-strong); font: inherit;
}
.logo-console table.grid { border-collapse: collapse; margin: 2px 0 6px; }
.logo-console table.grid th {
  text-align: left; color: var(--dim); font-weight: normal;
  padding: 0 12px 0 0; border-bottom: 1px solid rgba(147,161,161,0.2);
}
.logo-console table.grid td { padding: 1px 12px 1px 0; vertical-align: top; }
.logo-console .raw { color: var(--text-strong); }
`;
