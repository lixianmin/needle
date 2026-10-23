import { UI_SCRIPT } from "./ui/script.generated.js";

export interface PageOptions {
  basePath: string;
  /** 头栏与浏览器标签页显示的名字。 */
  title: string;
  version: string;
  /** SSE 的 topics 参数，如 "top:5000"。不传就用服务端默认间隔。 */
  topicSpec?: string;
}

/**
 * 服务端返回的那张页面。
 *
 * 只做一件事：把构建期打好的 UI 脚本内联进去，并把挂载参数塞进 data 属性。
 * 不引外部脚本、不引 CDN——Workers 上没有静态资源目录，内联是唯一稳妥的做法。
 */
export function renderPage(options: PageOptions): string {
  const topicSpec =
    options.topicSpec === undefined ? "" : ` data-topics="${escapeAttribute(options.topicSpec)}"`;

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttribute(options.title)}</title>
<style>html,body{margin:0;height:100%;background:#002b36}</style>
</head>
<body>
<div id="logo-root" style="height:100%" data-base-path="${escapeAttribute(options.basePath)}"${topicSpec}></div>
<script>${UI_SCRIPT}</script>
</body>
</html>`;
}

/** 属性值转义。basePath 来自宿主配置，不是用户输入，但拼 HTML 就该转义。 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
