import { createApi, traceOf } from "@needle/honox";
import { BotNameBody, BotsBody } from "../beans/bots.js";
import { getBotTemplate, getBotTemplates } from "../md/bot-template.js";
import { viper } from "../viper.js";

export function createBotsApi() {
  const api = createApi("api/bots");

  /**
   * `POST /bots/get_bots`，body 形如 `{"id":1}`：带 id 取单条，空 body 取全表。
   *
   * 示例的业务接口一律 POST + JSON body：id 是参数而不是路径段，query 也不再是入口。
   * 例行写法：`traceOf(ctx).info(request)` 一行同时拿到 trace 和第一条日志，
   * 之后每个出口都用 `trace.json` / `trace.notFound`——它们先落一行 info，
   * 再把响应返回出去。`ctx` 除了这次取 trace，基本不用再碰。
   */
  api.post("/bots/get_bots", BotsBody, (ctx, request) => {
    const trace = traceOf(ctx).info(request);

    const baseUrl = viper.getString("metadata.base_url");
    if (request.id === undefined) {
      return trace.json({ baseUrl, bots: getBotTemplates() });
    }

    const bot = getBotTemplate(request.id);
    if (bot === undefined) {
      // 404 那行只记响应体；request.id 已经在上一条日志里了，不重复带。
      return trace.notFound("bot 不存在");
    }
    return trace.json({ baseUrl, bot });
  });

  /**
   * `POST /bots/get_bot_name`，body 形如 `{"id":1}`：只回名字。
   *
   * 与 `get_bots` 一样，id 是筛选条件而不是路径段——路径里放 id 会让不存在
   * 的 id 也命中路由，最后还是要靠 handler 判断，白多一层。
   */
  api.post("/bots/get_bot_name", BotNameBody, (ctx, request) => {
    const trace = traceOf(ctx).info(request);

    const bot = getBotTemplate(request.id);
    if (bot === undefined) {
      return trace.notFound("bot 不存在");
    }
    return trace.json({ name: bot.name });
  });

  return api;
}
