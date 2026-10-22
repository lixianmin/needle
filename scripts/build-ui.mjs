import { writeFileSync } from "node:fs";

/**
 * 把浏览器端的 UI 打包成一个 IIFE 字符串，供 page.ts 内联。
 *
 * 为什么需要这一步：服务端要在 HTML 里内联脚本（Workers 没有静态资源目录），
 * 而浏览器/扩展场景要直接 import 同一个 view 模块（扩展的 CSP 不允许内联）。
 * 一份源码、两种产物，比写两套 UI 靠谱。
 */
const result = await Bun.build({
  entrypoints: ["src/console/ui/app.ts"],
  target: "browser",
  format: "iife",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const output = result.outputs[0];
if (output === undefined) {
  console.error("没有构建产物");
  process.exit(1);
}

const text = await output.text();
const target = "src/console/ui/script.generated.ts";
writeFileSync(
  target,
  `// 由 scripts/build-ui.mjs 生成，请勿手改。改 UI 请改 src/console/ui/ 下的源码后重跑。\nexport const UI_SCRIPT = ${JSON.stringify(text)};\n`,
);

console.log(`${target}: ${(text.length / 1024).toFixed(1)} KB`);
