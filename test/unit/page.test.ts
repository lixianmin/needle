import { describe, expect, test } from "bun:test";

import { renderPage } from "../../src/console/page.js";

describe("renderPage", () => {
  const page = renderPage({ basePath: "/__dbg", title: "node", version: "1.2.3", topicSpec: "top:5000" });

  test("是一个完整的 HTML 文档", () => {
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain('<div id="logo-root"');
    expect(page).toContain("<script>");
  });

  test("挂载参数落在 data 属性里", () => {
    expect(page).toContain('data-base-path="/__dbg"');
    expect(page).toContain('data-topics="top:5000"');
  });

  test("用 Solarized Dark 的底色", () => {
    expect(page).toContain("#002b36");
  });

  test("不引外部脚本、不走 CDN", () => {
    expect(page).not.toContain("<script src=");
    expect(page).not.toContain("http://");
    expect(page).not.toContain("https://");
  });

  test("内联脚本非空（构建产物已生成）", () => {
    const inline = page.slice(page.indexOf("<script>") + 8, page.indexOf("</script>"));
    expect(inline.length).toBeGreaterThan(1000);
  });

  test("空 basePath 时不带前缀", () => {
    const bare = renderPage({ basePath: "", title: "node", version: "x" });
    expect(bare).toContain('data-base-path=""');
    expect(bare).not.toContain("data-topics");
  });
});
