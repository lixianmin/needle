import { createApi, traceOf } from "@needle/honox";
import { BotsBody, BotsQuery } from "../beans/index.js";
import { getBotTemplate, getBotTemplates, type BotTemplate } from "../md/bot-template.js";
import { viper } from "../viper.js";

export const botsApi = createApi("api/bots");

/**
 * `GET /bots?id=1` 取单条，不带 id 取全表。
 *
 * 例行写法：`traceOf(ctx).info(request)` 一行同时拿到 trace 和第一条日志，
 * 之后每个出口都用 `trace.json` / `trace.notFound`——它们先落一行 info，
 * 再把响应返回出去。`ctx` 除了这次取 trace，基本不用再碰。
 */
botsApi.get("/bots", BotsQuery, (ctx, request) => {
  const trace = traceOf(ctx).info(request);

  const baseUrl = viper.getString("metadata.base_url");
  if (request.id === undefined) {
    return trace.json({ baseUrl, bots: getBotTemplates() });
  }

  const bot = getBotTemplate(request.id);
  if (bot === undefined) {
    return trace.notFound({ id: request.id, reason: "bot_not_found" }, "bot 不存在");
  }
  return trace.json({ baseUrl, bot });
});

/**
 * `POST /bots`，body 形如 `{"ids":[1,99]}`：命中的放在 `bots`，找不到的放在
 * `missing`——批量查询里"部分不存在"不该整单失败。
 */
botsApi.post("/bots", BotsBody, (ctx, request) => {
  const trace = traceOf(ctx).info(request);

  const bots: BotTemplate[] = [];
  const missing: number[] = [];
  for (const id of request.ids) {
    const bot = getBotTemplate(id);
    if (bot === undefined) {
      missing.push(id);
    } else {
      bots.push(bot);
    }
  }
  return trace.json({ bots, missing });
});
