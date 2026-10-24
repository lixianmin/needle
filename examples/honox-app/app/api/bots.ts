import { createApi, traceOf } from "@needle/honox";
import { ResponseX } from "@needle/shell";
import { BotsBody, BotsQuery } from "../model/bots.js";
import { getBotTemplate, getBotTemplates, type BotTemplate } from "../md/bot-template.js";
import { viper } from "../viper.js";

export const botsApi = createApi("api/bots");

/**
 * `GET /bots?id=1` 取单条，不带 id 取全表。
 *
 * 参数校验在库里：`id` 不是数字直接 400，handler 不用再判。
 * 顺带演示配置怎么取：handler 里直接 `import { viper }`，不走 request context。
 */
botsApi.get("/bots", BotsQuery, (ctx, query) => {
  traceOf(ctx).info({ id: query.id ?? null });
  const baseUrl = viper.getString("metadata.base_url");

  if (query.id === undefined) {
    return ctx.json({ baseUrl, bots: getBotTemplates() });
  }

  const bot = getBotTemplate(query.id);
  if (bot === undefined) {
    return ResponseX.notFound("bot 不存在");
  }
  return ctx.json({ baseUrl, bot });
});

/**
 * `POST /bots`，body 形如 `{"ids":[1,99]}`：命中的放在 `bots`，找不到的放在
 * `missing`——批量查询里"部分不存在"不该整单失败。
 *
 * 日志只挑想看的字段：body 原样整份打进日志，客户端传多大就写多大。
 */
botsApi.post("/bots", BotsBody, (ctx, body) => {
  traceOf(ctx).info({ ids: body.ids });

  const bots: BotTemplate[] = [];
  const missing: number[] = [];
  for (const id of body.ids) {
    const bot = getBotTemplate(id);
    if (bot === undefined) {
      missing.push(id);
    } else {
      bots.push(bot);
    }
  }
  return ctx.json({ bots, missing });
});
