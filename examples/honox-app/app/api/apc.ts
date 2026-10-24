import { Hono } from "hono";
import { apiRoute } from "@needle/honox";
import { ResponseX } from "@needle/shell";
import { getApcTemplate, getApcTemplates } from "../md/apc-template";

export const apcApi = new Hono();

/** `?id=1` 取单条；不带 id 取全表。 */
apcApi.get(
  "/apc",
  apiRoute((c) => {
    const raw = c.req.query("id");
    if (raw === undefined) {
      return c.json(getApcTemplates());
    }

    const id = Number(raw);
    if (!Number.isFinite(id)) {
      return ResponseX.badRequest(`id 必须是数字：${raw}`);
    }

    const apc = getApcTemplate(id);
    if (apc === undefined) {
      return ResponseX.notFound("apc 不存在");
    }
    return c.json(apc);
  }),
);
