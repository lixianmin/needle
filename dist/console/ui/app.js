import { createFetchAdapter } from "./fetch-adapter.js";
import { mountConsole } from "./view.js";
/**
 * 服务端页面里的引导脚本。
 *
 * 构建时被打包成一个 IIFE 字符串（见 scripts/build-ui.mjs），由 page.ts
 * 内联进 HTML。因此在 Workers 上也不需要额外静态资源。
 */
const mountPoint = document.getElementById("logo-root");
const root = mountPoint ?? document.body;
const data = mountPoint?.dataset ?? {};
mountConsole(root, createFetchAdapter({
    basePath: data.basePath ?? "",
    ...(data.topics === undefined ? {} : { topics: data.topics }),
}));
