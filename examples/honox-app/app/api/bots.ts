import { createApi } from "@needle/honox";
import { ResponseX } from "@needle/shell";
import { getBotTemplate, getBotTemplates, type BotTemplate } from "../md/bot-template.js";
import { viper } from "../viper.js";

export const botsApi = createApi();

/**
 * `GET /bots?id=1` 取单条，不带 id 取全表。
 *
 * 顺带演示配置怎么取：handler 里直接 `import { viper }`，不走 request context。
 * 返回里带上 metadata 目录，确认读的是配置里的那一份。
 */
botsApi.get("/bots", (c) => {
  const baseUrl = viper.getString("metadata.base_url");
  const raw = c.req.query("id");

  if (raw === undefined) {
    return c.json({ baseUrl, bots: getBotTemplates() });
  }

  const id = Number(raw);
  if (!Number.isFinite(id)) {
    return ResponseX.badRequest(`id 必须是数字：${raw}`);
  }

  const bot = getBotTemplate(id);
  if (bot === undefined) {
    return ResponseX.notFound("bot 不存在");
  }
  return c.json({ baseUrl, bot });
});

/**
 * `POST /bots`，body 形如 `{"ids":[1,99]}`：命中的放在 `bots`，找不到的放在
 * `missing`——批量查询里"部分不存在"不该整单失败。
 */
botsApi.post("/bots", async (c) => {
  const body: unknown = await c.req.json().catch(() => undefined);
  const ids = (body as { ids?: unknown } | undefined)?.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "number")) {
    return ResponseX.badRequest('body 形如 {"ids":[1,2]}');
  }

  const bots: BotTemplate[] = [];
  const missing: number[] = [];
  for (const id of ids as number[]) {
    const bot = getBotTemplate(id);
    if (bot === undefined) {
      missing.push(id);
    } else {
      bots.push(bot);
    }
  }
  return c.json({ bots, missing });
});
