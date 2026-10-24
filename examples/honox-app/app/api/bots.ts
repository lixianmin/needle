import { createApi, traceOf } from "@needle/honox";
import { ResponseX } from "@needle/shell";
import { BotsBody, BotsQuery } from "../beans/index.js";
import { getBotTemplate, getBotTemplates, type BotTemplate } from "../md/bot-template.js";
import { viper } from "../viper.js";

export const botsApi = createApi("api/bots");

/**
 * `GET /bots?id=1` 取单条，不带 id 取全表。
 *
 * 参数校验在库里：`id` 不是数字直接 400，handler 不用再判。
 * `trace` 在开头取一次，后面每个出口都能用：log 一次不是一次性消耗品。
 */
botsApi.get("/bots", BotsQuery, (ctx, query) => {
  const trace = traceOf(ctx);
  trace.info({ id: query.id ?? null });

  const baseUrl = viper.getString("metadata.base_url");
  if (query.id === undefined) {
    return ctx.json({ baseUrl, bots: getBotTemplates() });
  }

  const bot = getBotTemplate(query.id);
  if (bot === undefined) {
    trace.warn({ id: query.id, reason: "bot_not_found" });
    return ResponseX.notFound("bot 不存在");
  }
  return ctx.json({ baseUrl, bot });
});

/**
 * `POST /bots`，body 形如 `{"ids":[1,99]}`：命中的放在 `bots`，找不到的放在
 * `missing`——批量查询里"部分不存在"不该整单失败。
 *
 * 日志只挑想看的字段（这里只打 ids）：body 里的密码、超大字段不传就是不打。
 */
botsApi.post("/bots", BotsBody, (ctx, body) => {
  const trace = traceOf(ctx);

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

  trace.info({ ids: body.ids, hit: bots.length, missing: missing.length });
  return ctx.json({ bots, missing });
});
