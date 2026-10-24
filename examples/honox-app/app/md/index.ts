import { loadSheets } from "@needle/honox/excel";
import { apcTemplate } from "./apc-template";
import { botTemplate } from "./bot-template";

/**
 * 预载 res/metadata 下所有模板表。
 *
 * hucre 只能异步读，所以启动时在这里一次读完；之后各 getXxxTemplate 都是
 * 同步、零 IO。新增一张表 = 在 app/md 加一个文件，再把它加进这里的数组。
 */
export async function initTemplates(): Promise<void> {
  await loadSheets([botTemplate, apcTemplate]);
}

export { getApcTemplate } from "./apc-template";
export { getBotTemplate } from "./bot-template";
