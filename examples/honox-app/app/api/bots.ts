import { Hono } from "hono";
import { ResponseX } from "@needle/shell";
import { getBotTemplate, getBotTemplates } from "../md/bot-template";

export const botsApi = new Hono();

/**
 * `?id=1` 取单条；不带 id 取全表。
 * 用 query 而不是路径段：id 是可选筛选条件，不是资源路径的一部分。
 */
botsApi.get("/bots", (c) => {
  const raw = c.req.query("id");
  if (raw === undefined) {
    return c.json(getBotTemplates());
  }

  const id = Number(raw);
  if (!Number.isFinite(id)) {
    return ResponseX.badRequest(`id 必须是数字：${raw}`);
  }

  const bot = getBotTemplate(id);
  if (bot === undefined) {
    return ResponseX.notFound("bot 不存在");
  }
  return c.json(bot);
});
