import { createMetadata } from "@needle/honox/excel";

/**
 * 元数据管理器：第一层 key 是 sheet 名（`BotTemplate` 这种大写原样），
 * 第二层才是 id。
 *
 * 新增一张表 = 在 `app/md/` 加一个文件，用 `metadata.template/config` 声明；
 * 这个文件与 `server.ts` 都不用改——表是启动时扫目录发现的。
 */
export const metadata = createMetadata();

/**
 * 扫描配置里 `metadata.base_url` 指向的目录（示例是 `res/metadata`）：
 * sheet 名以 `Template` 结尾的按 id 建表，以 `Config` 结尾的当全局单例，
 * 其余跳过。
 *
 * hucre 只能异步读，所以启动时一次读完；之后各 getter 同步、零 IO。
 */
export async function initTemplates(dir: string): Promise<void> {
  const report = await metadata.load(dir);
  console.info(
    `[metadata] 已加载 templates=[${report.templates.join(", ")}] configs=[${report.configs.join(", ")}]` +
      (report.skipped.length === 0 ? "" : ` 跳过=[${report.skipped.join(", ")}]`),
  );
}
